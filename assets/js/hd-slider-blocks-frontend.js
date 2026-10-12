/**
 * Frontend Splide initialiser for slider-enabled blocks.
 *
 * Block-agnostic by design: it picks up anything carrying .is-slider and reads
 * its settings off data attributes, so core/group and core/query share it even
 * though PHP builds their slide markup by different routes.
 *
 * Splide's native `perPage` is integer-only. To support fractional values
 * (2.5, 3.5, etc.) we compute `fixedWidth` ourselves from the track width,
 * gap, and the current slidesToShow value. slidesToShow varies by viewport:
 *
 *   viewport width            → value used
 *   < 768px                   → data-slides-to-show-mobile (default 1)
 *   768px – 1023px            → data-slides-to-show-tablet (0 = inherit desktop)
 *   >= 1024px                 → data-slides-to-show
 *
 * The PHP render filters hand over finished Splide markup either way — a group
 * has each direct child wrapped in <li class="splide__slide">, a query loop has
 * its own post list relabelled — so this script just initialises Splide and
 * keeps fixedWidth in sync with resize events and breakpoint crossings.
 *
 * Driving the layout from fixedWidth rather than perPage leaves perPage at 1,
 * which quietly breaks three of Splide's own end-of-slider defaults. See the
 * comments on trimSpace, omitEnd and focus in the options below, and on the
 * overflow handler after them.
 */
( function () {
	'use strict';

	const TABLET_MAX  = 1023;
	const MOBILE_MAX  = 767;

	/**
	 * Convert a CSS length string ("16px", "1rem", "2vw") to a pixel value,
	 * resolved in the context of the given element. Returns 0 for empty input.
	 */
	function parseCssLength( value, contextEl ) {
		if ( ! value ) return 0;
		const trimmed = String( value ).trim();
		const px = parseFloat( trimmed );
		if ( ! isNaN( px ) && /^[\d.]+(px)?$/.test( trimmed ) ) {
			return px;
		}
		const test = document.createElement( 'div' );
		test.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:0;';
		test.style.width = trimmed;
		contextEl.appendChild( test );
		const measured = test.offsetWidth;
		test.remove();
		return measured;
	}

	function pickSlidesToShow( viewportWidth, desktop, tablet, mobile ) {
		if ( viewportWidth <= MOBILE_MAX ) {
			return mobile > 0 ? mobile : 1;
		}
		if ( viewportWidth <= TABLET_MAX ) {
			return tablet > 0 ? tablet : desktop;
		}
		return desktop;
	}

	/**
	 * Flag the slides that sit wholly inside the track, so the stylesheet can
	 * dim the rest.
	 *
	 * Splide has its own is-visible class for this, but it only recomputes on
	 * `moved` — after the transition has finished — which makes the fade lag a
	 * click by the length of the slide animation. Its own updateOnMove option
	 * does not help: the handler measures live rects, and at `move` time the
	 * list has not been translated yet, so it just re-measures where the
	 * slides already are.
	 *
	 * So we measure ahead instead. Splide's Move component can say what track
	 * position an index will settle at, trimming and all, and the difference
	 * from the current position is the distance every slide is about to
	 * travel. Adding it to the current rects gives the destination layout
	 * before the transition starts. Passing no destination measures where
	 * things are right now, which is what the drag and resize paths want.
	 *
	 * Horizontal sliders only: the offset is applied along the inline axis,
	 * which is the axis Splide translates on unless direction is 'ttb'.
	 */
	function markSlidesInView( splide, destIndex ) {
		const Move  = splide.Components.Move;
		const track = splide.Components.Elements.track;
		if ( ! Move || ! track ) return;

		const delta = typeof destIndex === 'number'
			? Move.toPosition( destIndex, true ) - Move.getPosition()
			: 0;

		const trackRect = track.getBoundingClientRect();

		splide.Components.Slides.forEach( ( slide ) => {
			const rect  = slide.slide.getBoundingClientRect();
			const start = rect.left + delta;
			const end   = rect.right + delta;
			// A pixel of slack, because a slide sitting flush against the
			// track edge lands a fraction outside it often enough to flicker.
			const inView = start >= trackRect.left - 1 && end <= trackRect.right + 1;
			slide.slide.classList.toggle( 'is-in-view', inView );
		} );
	}

	function computeFixedWidth( el, slidesToShow, gapPx ) {
		const track = el.querySelector( '.splide__track' );
		if ( ! track ) return 0;
		const trackWidth = track.clientWidth;
		if ( trackWidth <= 0 || slidesToShow <= 0 ) return 0;
		return ( trackWidth - gapPx * ( slidesToShow - 1 ) ) / slidesToShow;
	}

	function initSliders() {
		if ( typeof window.Splide !== 'function' ) return;

		const sliders = document.querySelectorAll( '.is-slider:not(.is-slider-initialised)' );
		sliders.forEach( ( el ) => {
			const desktop = parseFloat( el.getAttribute( 'data-slides-to-show' ) )        || 3;
			const tablet  = parseFloat( el.getAttribute( 'data-slides-to-show-tablet' ) ) || 0;
			const mobile  = parseFloat( el.getAttribute( 'data-slides-to-show-mobile' ) ) || 1;
			const gap     = el.getAttribute( 'data-slide-gap' ) || '0';
			const arrows  = el.getAttribute( 'data-arrows' ) === '1';
			const dots    = el.getAttribute( 'data-dots' )   === '1';

			const initialN  = pickSlidesToShow( window.innerWidth, desktop, tablet, mobile );
			const gapPx     = parseCssLength( gap, el );
			const initialW  = computeFixedWidth( el, initialN, gapPx );

			const options = {
				arrows:     arrows,
				pagination: dots,
				drag:       'free',
				snap:       true,
				// Clamps the end position to (sliderSize - listSize). Without
				// it the track keeps moving after the last slide, leaving dead
				// space beside it. The right-edge bleed is unaffected: that
				// comes from the track's overflow and a fractional fixedWidth,
				// so slides still bleed while there is more to come and sit
				// flush once the end is reached.
				trimSpace:  true,
				// Drops the trailing indices that all resolve to that same
				// clamped end position, so Next disables at the real end and
				// the dots stop repeating it. Does nothing unless trimSpace is
				// on, since the duplicate positions only exist once clamped.
				omitEnd:    true,
				// Not a layout change — focus 0 and no focus at all both put
				// the active slide at the left edge. It is here because it is
				// what makes Splide count pagination dots by reachable
				// position rather than one per slide, which with perPage at 1
				// would be one per post.
				focus:      0,
				gap:        gap,
				fixedWidth: initialW || 320,
			};

			try {
				const splide = new window.Splide( el, options );

				// Splide works out whether the slides actually overflow the
				// track, but acts on it nowhere: its own "is there enough to
				// scroll" test counts slides against perPage, which is always
				// 1 here, so a query returning fewer posts than fit still gets
				// arrows, dots and drag. Bound before mount() because the
				// event fires during the first layout pass.
				splide.on( 'overflow', ( isOverflow ) => {
					splide.go( 0 );
					splide.options = {
						arrows:     arrows && isOverflow,
						pagination: dots && isOverflow,
						drag:       isOverflow && 'free',
					};
				} );

				// `move` fires as the transition starts, so the fade runs
				// alongside the slide rather than after it. The rest are the
				// points where the layout settles without a move: the initial
				// mount, a free drag, and a resize or option change.
				splide.on( 'move', ( destIndex ) => markSlidesInView( splide, destIndex ) );
				splide.on( 'mounted moved dragging scrolled resized updated', () => markSlidesInView( splide ) );

				splide.mount();
				el.classList.add( 'is-slider-initialised' );

				let resizeTimer = null;
				window.addEventListener( 'resize', () => {
					clearTimeout( resizeTimer );
					resizeTimer = setTimeout( () => {
						const n = pickSlidesToShow( window.innerWidth, desktop, tablet, mobile );
						const g = parseCssLength( gap, el );
						const w = computeFixedWidth( el, n, g );
						if ( w > 0 ) {
							splide.options = { fixedWidth: w };
						}
					}, 150 );
				} );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'HD Slider Blocks init failed:', err );
			}
		} );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', initSliders );
	} else {
		initSliders();
	}
} )();
