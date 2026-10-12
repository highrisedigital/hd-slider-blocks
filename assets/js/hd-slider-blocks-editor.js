/**
 * Slider option for core/group and core/query.
 *
 * Adds:
 *  - Attributes: isSlider, slidesToShow (+ Tablet/Mobile), slideGap, showArrows,
 *    arrowPosition, showDots
 *  - A "Slider" variation of core/group (appears in inserter + transform menu)
 *  - Sidebar panel with width / gap / arrows / dots controls
 *  - A preview class + CSS vars on the editor wrapper so the editor roughly
 *    shows horizontal overflow instead of the block's native layout
 *
 * Group and Query Loop share everything here; only the PHP render path differs.
 */
( function ( wp ) {
	const { addFilter } = wp.hooks;
	const { createElement: h, Fragment } = wp.element;
	const { InspectorControls } = wp.blockEditor;
	const {
		PanelBody,
		ToggleControl,
		SelectControl,
		__experimentalNumberControl,
		TextControl,
	} = wp.components;
	const { createHigherOrderComponent } = wp.compose;
	const { __ } = wp.i18n;
	const { registerBlockVariation } = wp.blocks;

	const NumberControl = __experimentalNumberControl || wp.components.NumberControl || TextControl;

	const GROUP_BLOCK   = 'core/group';
	const QUERY_BLOCK   = 'core/query';
	const TARGET_BLOCKS = [ GROUP_BLOCK, QUERY_BLOCK ];

	// Mirrors the theme's settings.spacing.spacingSizes slugs. Stored as the
	// resolved CSS var so it drops straight into data-slide-gap and any inline
	// style without conversion.
	const SPACING_SIZES = [
		{ slug: '3xs', label: '3XS — 5px'      },
		{ slug: '2xs', label: '2XS — 9–10px'   },
		{ slug: 'xs',  label: 'XS — 14–15px'   },
		{ slug: 's',   label: 'S — 18–20px'    },
		{ slug: 'm',   label: 'M — 27–30px'    },
		{ slug: 'l',   label: 'L — 36–40px'    },
		{ slug: 'xl',  label: 'XL — 54–60px'   },
		{ slug: '2xl', label: '2XL — 72–80px'  },
		{ slug: '3xl', label: '3XL — 108–120px' },
	];
	const SLIDE_GAP_OPTIONS = SPACING_SIZES.map( ( s ) => ( {
		value: `var(--wp--preset--spacing--${ s.slug })`,
		label: s.label,
	} ) );
	const DEFAULT_SLIDE_GAP = 'var(--wp--preset--spacing--m)';

	// Placement of the previous/next arrows. Each value has a matching
	// is-slider-arrows-* class in assets/css/hd-slider-blocks.css, and the
	// same list is validated server-side in hd_slider_blocks_arrow_positions().
	const ARROW_POSITION_OPTIONS = [
		{ value: 'sides',        label: __( 'Left and right of the slider', 'hd-slider-blocks' ) },
		{ value: 'top-left',     label: __( 'Above, left',  'hd-slider-blocks' ) },
		{ value: 'top-right',    label: __( 'Above, right', 'hd-slider-blocks' ) },
		{ value: 'bottom-left',  label: __( 'Below, left',  'hd-slider-blocks' ) },
		{ value: 'bottom-right', label: __( 'Below, right', 'hd-slider-blocks' ) },
	];
	const DEFAULT_ARROW_POSITION = 'sides';

	/**
	 * Blocks saved before the arrow placement option existed hold nothing, so
	 * fall back to the default rather than showing an empty select.
	 */
	function normaliseArrowPosition( value ) {
		return ARROW_POSITION_OPTIONS.some( ( o ) => o.value === value ) ? value : DEFAULT_ARROW_POSITION;
	}

	/**
	 * Blocks saved before the gap options matched the theme scale hold a slug
	 * that no longer resolves to anything. Fall back to the default so the
	 * control shows a real value rather than an empty select.
	 */
	function normaliseSlideGap( value ) {
		return SLIDE_GAP_OPTIONS.some( ( o ) => o.value === value ) ? value : DEFAULT_SLIDE_GAP;
	}

	/* ── 1. Add attributes to the target blocks ─────────────── */
	addFilter(
		'blocks.registerBlockType',
		'hd-slider-blocks/attributes',
		( settings, name ) => {
			if ( ! TARGET_BLOCKS.includes( name ) ) {
				return settings;
			}
			settings.attributes = Object.assign( {}, settings.attributes, {
				isSlider:           { type: 'boolean', default: false },
				slidesToShow:       { type: 'number',  default: 3 },
				slidesToShowTablet: { type: 'number',  default: 0 }, // 0 = inherit desktop
				slidesToShowMobile: { type: 'number',  default: 1 },
				slideGap:           { type: 'string',  default: DEFAULT_SLIDE_GAP },
				showArrows:         { type: 'boolean', default: true },
				arrowPosition:      { type: 'string',  default: DEFAULT_ARROW_POSITION },
				showDots:           { type: 'boolean', default: true },
			} );
			return settings;
		}
	);

	/**
	 * ── 2. Register the variation ───────────────────────────
	 *
	 * Group only. Inserting a Query Loop goes through core's own pattern
	 * chooser, which a block variation competes with, so Query Loops are turned
	 * into sliders with the sidebar toggle instead (see below).
	 */
	registerBlockVariation( GROUP_BLOCK, {
		name:        'hd-slider',
		title:       __( 'Slider', 'hd-slider-blocks' ),
		description: __( 'A horizontal slider that overflows the right edge of the screen. Arrows and dots optional.', 'hd-slider-blocks' ),
		category:    'design',
		icon:        'slides',
		attributes: {
			isSlider:           true,
			slidesToShow:       3,
			slidesToShowTablet: 0,
			slidesToShowMobile: 1,
			slideGap:           DEFAULT_SLIDE_GAP,
			showArrows:         true,
			arrowPosition:      DEFAULT_ARROW_POSITION,
			showDots:           true,
			layout:             { type: 'default' },
		},
		isActive: ( blockAttributes ) => blockAttributes.isSlider === true,
		scope: [ 'inserter', 'transform' ],
	} );

	/**
	 * ── 3. Sidebar controls ─────────────────────────────────
	 *
	 * Query Loops always show the panel, because the toggle is the only way to
	 * switch one into a slider. Groups only show it once the slider is on —
	 * they are everywhere in a page, and the inserter variation is how you
	 * start one — so the panel stays out of the way the rest of the time.
	 */
	const withSliderControls = createHigherOrderComponent( ( BlockEdit ) => {
		return ( props ) => {
			const isTarget = TARGET_BLOCKS.includes( props.name );
			const isOn     = !! props.attributes.isSlider;

			if ( ! isTarget || ( ! isOn && props.name !== QUERY_BLOCK ) ) {
				return h( BlockEdit, props );
			}

			const { attributes, setAttributes } = props;

			const toggle = h( ToggleControl, {
				label: __( 'Enable slider', 'hd-slider-blocks' ),
				help:  props.name === QUERY_BLOCK
					? __( 'Show the posts as a horizontal slider instead of a list or grid.', 'hd-slider-blocks' )
					: __( 'Turn this group into a horizontal slider on the frontend.', 'hd-slider-blocks' ),
				checked: isOn,
				onChange: ( val ) => setAttributes( { isSlider: val } ),
			} );

			const settings = ! isOn ? [] : [
				h( NumberControl, {
					label: __( 'Slides to show (desktop)', 'hd-slider-blocks' ),
					help:  __( 'Number of slides visible at once. Decimals show partial slides (e.g. 2.5 = two and a half).', 'hd-slider-blocks' ),
					value: attributes.slidesToShow,
					min:   1,
					step:  0.1,
					onChange: ( val ) => {
						const n = parseFloat( val );
						setAttributes( { slidesToShow: isNaN( n ) ? 1 : Math.max( 1, n ) } );
					},
				} ),
				h( NumberControl, {
					label: __( 'Slides to show (tablet)', 'hd-slider-blocks' ),
					help:  __( 'Set to 0 to match the desktop value. Applies between 768px and 1023px.', 'hd-slider-blocks' ),
					value: attributes.slidesToShowTablet,
					min:   0,
					step:  0.1,
					onChange: ( val ) => {
						const n = parseFloat( val );
						setAttributes( { slidesToShowTablet: isNaN( n ) ? 0 : Math.max( 0, n ) } );
					},
				} ),
				h( NumberControl, {
					label: __( 'Slides to show (mobile)', 'hd-slider-blocks' ),
					help:  __( 'Applies below 768px.', 'hd-slider-blocks' ),
					value: attributes.slidesToShowMobile,
					min:   1,
					step:  0.1,
					onChange: ( val ) => {
						const n = parseFloat( val );
						setAttributes( { slidesToShowMobile: isNaN( n ) ? 1 : Math.max( 1, n ) } );
					},
				} ),
				h( SelectControl, {
					label:   __( 'Gap between slides', 'hd-slider-blocks' ),
					help:    __( 'Picks from the theme spacing scale.', 'hd-slider-blocks' ),
					value:   normaliseSlideGap( attributes.slideGap ),
					options: SLIDE_GAP_OPTIONS,
					onChange: ( val ) => setAttributes( { slideGap: val || DEFAULT_SLIDE_GAP } ),
				} ),
				h( ToggleControl, {
					label: __( 'Show arrows', 'hd-slider-blocks' ),
					checked: !! attributes.showArrows,
					onChange: ( val ) => setAttributes( { showArrows: val } ),
				} ),
				// Placement is meaningless with the arrows off, so it only
				// appears once they are on.
				attributes.showArrows ? h( SelectControl, {
					label:   __( 'Arrow position', 'hd-slider-blocks' ),
					help:    __( 'Where the previous and next arrows sit relative to the slides.', 'hd-slider-blocks' ),
					value:   normaliseArrowPosition( attributes.arrowPosition ),
					options: ARROW_POSITION_OPTIONS,
					onChange: ( val ) => setAttributes( { arrowPosition: val || DEFAULT_ARROW_POSITION } ),
				} ) : null,
				h( ToggleControl, {
					label: __( 'Show dots', 'hd-slider-blocks' ),
					checked: !! attributes.showDots,
					onChange: ( val ) => setAttributes( { showDots: val } ),
				} ),
			];

			// Pagination cannot work inside a slider — every post has to be in
			// the DOM at once — so say so rather than leaving authors guessing.
			const notice = ( isOn && props.name === QUERY_BLOCK )
				? h( 'p', { style: { fontStyle: 'italic' } },
					__( 'Pagination is hidden while the slider is on. Set the number of posts to show them all.', 'hd-slider-blocks' )
				)
				: null;

			return h(
				Fragment,
				null,
				h( BlockEdit, props ),
				h(
					InspectorControls,
					null,
					h(
						PanelBody,
						{ title: __( 'Slider', 'hd-slider-blocks' ), initialOpen: isOn },
						toggle,
						...settings,
						notice
					)
				)
			);
		};
	}, 'withSliderControls' );

	addFilter( 'editor.BlockEdit', 'hd-slider-blocks/controls', withSliderControls );

	/* ── 4. Editor-side wrapper class + CSS vars for preview ── */
	const withSliderWrapper = createHigherOrderComponent( ( BlockListBlock ) => {
		return ( props ) => {
			if ( ! TARGET_BLOCKS.includes( props.name ) || ! props.attributes.isSlider ) {
				return h( BlockListBlock, props );
			}
			const desktop = props.attributes.slidesToShow || 3;
			const tablet  = props.attributes.slidesToShowTablet > 0 ? props.attributes.slidesToShowTablet : desktop;
			const mobile  = props.attributes.slidesToShowMobile || 1;
			const style = Object.assign( {}, props.wrapperProps && props.wrapperProps.style, {
				'--hd-slider-slides-to-show-desktop': String( desktop ),
				'--hd-slider-slides-to-show-tablet':  String( tablet ),
				'--hd-slider-slides-to-show-mobile':  String( mobile ),
				'--hd-slider-slide-gap':              normaliseSlideGap( props.attributes.slideGap ),
			} );
			const className = ( props.className || '' ) + ' is-slider-editor-preview';
			return h( BlockListBlock, Object.assign( {}, props, {
				className,
				wrapperProps: Object.assign( {}, props.wrapperProps, { style } ),
			} ) );
		};
	}, 'withSliderWrapper' );

	addFilter( 'editor.BlockListBlock', 'hd-slider-blocks/wrapper', withSliderWrapper );

	/* ── 5. Add class + data attrs to saved markup ──────────── */
	addFilter(
		'blocks.getSaveContent.extraProps',
		'hd-slider-blocks/save-props',
		( extraProps, blockType, attributes ) => {
			if ( ! TARGET_BLOCKS.includes( blockType.name ) || ! attributes.isSlider ) {
				return extraProps;
			}
			extraProps.className = ( extraProps.className || '' )
				+ ' is-slider is-slider-arrows-' + normaliseArrowPosition( attributes.arrowPosition );
			extraProps[ 'data-slides-to-show' ]        = String( attributes.slidesToShow || 3 );
			extraProps[ 'data-slides-to-show-tablet' ] = String( attributes.slidesToShowTablet || 0 );
			extraProps[ 'data-slides-to-show-mobile' ] = String( attributes.slidesToShowMobile || 1 );
			extraProps[ 'data-slide-gap' ]             = attributes.slideGap || '';
			extraProps[ 'data-arrows' ]                = attributes.showArrows ? '1' : '0';
			extraProps[ 'data-dots' ]                  = attributes.showDots   ? '1' : '0';
			return extraProps;
		}
	);
} )( window.wp );
