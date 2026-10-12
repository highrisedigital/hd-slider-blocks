<?php
/**
 * Plugin Name:       HD Slider Blocks
 * Description:       Turns a Group or a Query Loop into a horizontal slider, powered by Splide. Arrows, arrow placement, dots, and per-breakpoint slides-to-show are set per block in the editor.
 * Version:           1.3.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Author:            Highrise Digital
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       hd-slider-blocks
 */

defined( 'ABSPATH' ) || exit;

/**
 * Blocks that can be turned into a slider.
 *
 * Group builds its slides from its own inner blocks; Query Loop builds them
 * from the posts core/post-template renders. The two render paths differ, but
 * the stored attributes, controls, styles and frontend script are shared.
 */
const HD_SLIDER_BLOCKS_TARGETS = array( 'core/group', 'core/query' );

/**
 * Version an asset by its file mtime so edits cache-bust automatically.
 * Falls back to false (no version query string) if the file is missing.
 */
function hd_slider_blocks_asset_ver( string $rel_path ): string|false {
	$path = __DIR__ . '/' . $rel_path;
	return file_exists( $path ) ? (string) filemtime( $path ) : false;
}

/**
 * Resolve a stored slide gap to a spacing preset the theme actually defines.
 *
 * Blocks saved before the gap options were aligned with the theme scale hold
 * slugs that resolve to nothing, which silently collapses the gap to zero, so
 * anything unrecognised falls back to the default preset.
 */
function hd_slider_blocks_slide_gap( string $value ): string {
	$slugs   = [ '3xs', '2xs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl' ];
	$allowed = array_map(
		static fn( string $slug ): string => "var(--wp--preset--spacing--{$slug})",
		$slugs
	);
	return in_array( $value, $allowed, true ) ? $value : 'var(--wp--preset--spacing--m)';
}

/**
 * The arrow placements an author can choose.
 *
 * 'sides' puts one arrow either side of the track, vertically centred; the
 * four corner values clear the track, above or below it. Each has a matching
 * is-slider-arrows-* rule in assets/css/hd-slider-blocks.css and an option in
 * assets/js/hd-slider-blocks-editor.js.
 */
function hd_slider_blocks_arrow_positions(): array {
	return array( 'sides', 'top-left', 'top-right', 'bottom-left', 'bottom-right' );
}

/**
 * Resolve a stored arrow placement, falling back to the default.
 *
 * Blocks saved before this option existed hold nothing at all, so anything
 * unrecognised becomes 'sides' rather than leaving the arrows unpositioned.
 */
function hd_slider_blocks_arrow_position( string $value ): string {
	return in_array( $value, hd_slider_blocks_arrow_positions(), true ) ? $value : 'sides';
}

/**
 * The class the stylesheet keys arrow placement off, for a stored value.
 */
function hd_slider_blocks_arrow_class( string $value ): string {
	return 'is-slider-arrows-' . hd_slider_blocks_arrow_position( $value );
}

/**
 * The slider attributes shared by every target block.
 *
 * Registered server-side as well as in the editor because core/query has to
 * expose isSlider through block context, and context can only be provided from
 * a registered attribute.
 */
function hd_slider_blocks_attributes(): array {
	return array(
		'isSlider'           => array(
			'type'    => 'boolean',
			'default' => false,
		),
		'slidesToShow'       => array(
			'type'    => 'number',
			'default' => 3,
		),
		'slidesToShowTablet' => array(
			'type'    => 'number',
			'default' => 0, // 0 = inherit desktop.
		),
		'slidesToShowMobile' => array(
			'type'    => 'number',
			'default' => 1,
		),
		'slideGap'           => array(
			'type'    => 'string',
			'default' => 'var(--wp--preset--spacing--m)',
		),
		'showArrows'         => array(
			'type'    => 'boolean',
			'default' => true,
		),
		'arrowPosition'      => array(
			'type'    => 'string',
			'default' => 'sides',
		),
		'showDots'           => array(
			'type'    => 'boolean',
			'default' => true,
		),
	);
}

/**
 * Normalise the attributes stored on a block into render-ready slider options.
 */
function hd_slider_blocks_options( array $attrs ): array {
	$desktop = isset( $attrs['slidesToShow'] ) ? (float) $attrs['slidesToShow'] : 3.0;
	$tablet  = isset( $attrs['slidesToShowTablet'] ) ? (float) $attrs['slidesToShowTablet'] : 0.0;
	$mobile  = isset( $attrs['slidesToShowMobile'] ) ? (float) $attrs['slidesToShowMobile'] : 1.0;

	return array(
		'desktop'       => max( 1.0, $desktop ),
		'tablet'        => max( 0.0, $tablet ),
		'mobile'        => max( 1.0, $mobile ),
		'gap'           => hd_slider_blocks_slide_gap( (string) ( $attrs['slideGap'] ?? '' ) ),
		// Editor schema defaults these to true, so a missing key means "on".
		'arrows'        => (bool) ( $attrs['showArrows'] ?? true ),
		'dots'          => (bool) ( $attrs['showDots'] ?? true ),
		'arrow_class'   => hd_slider_blocks_arrow_class( (string) ( $attrs['arrowPosition'] ?? '' ) ),
	);
}

/**
 * The data-* attributes assets/js/hd-slider-blocks-frontend.js reads off the
 * slider root, keyed by attribute name.
 */
function hd_slider_blocks_data_attributes( array $options ): array {
	return array(
		'data-slides-to-show'        => (string) $options['desktop'],
		'data-slides-to-show-tablet' => (string) $options['tablet'],
		'data-slides-to-show-mobile' => (string) $options['mobile'],
		'data-slide-gap'             => $options['gap'],
		'data-arrows'                => $options['arrows'] ? '1' : '0',
		'data-dots'                  => $options['dots'] ? '1' : '0',
	);
}

/**
 * Register the slider attributes on the target blocks, and have core/query pass
 * isSlider down as context so core/post-template knows to relabel its markup.
 */
add_filter( 'block_type_metadata', function ( array $metadata ): array {
	$name = $metadata['name'] ?? '';

	if ( in_array( $name, HD_SLIDER_BLOCKS_TARGETS, true ) ) {
		$metadata['attributes'] = array_merge(
			$metadata['attributes'] ?? array(),
			hd_slider_blocks_attributes()
		);
	}

	if ( 'core/query' === $name ) {
		$metadata['providesContext'] = array_merge(
			$metadata['providesContext'] ?? array(),
			array( 'hdSlider/isSlider' => 'isSlider' )
		);
	}

	if ( 'core/post-template' === $name ) {
		$metadata['usesContext']   = $metadata['usesContext'] ?? array();
		$metadata['usesContext'][] = 'hdSlider/isSlider';
	}

	return $metadata;
} );

/**
 * Frontend: enqueue Splide + the slider init script and styles.
 * Conditional load would require walking post content on every request; the
 * bundle is tiny (~30kb) so we just enqueue site-wide.
 */
add_action( 'wp_enqueue_scripts', function (): void {
	$url = plugin_dir_url( __FILE__ );

	wp_enqueue_style(
		'splide-core',
		$url . 'assets/css/splide-core.min.css',
		[],
		hd_slider_blocks_asset_ver( 'assets/css/splide-core.min.css' )
	);
	wp_enqueue_style(
		'hd-slider-blocks',
		$url . 'assets/css/hd-slider-blocks.css',
		[ 'splide-core' ],
		hd_slider_blocks_asset_ver( 'assets/css/hd-slider-blocks.css' )
	);
	wp_enqueue_script(
		'splide',
		$url . 'assets/js/splide.min.js',
		[],
		hd_slider_blocks_asset_ver( 'assets/js/splide.min.js' ),
		true
	);
	wp_enqueue_script(
		'hd-slider-blocks-frontend',
		$url . 'assets/js/hd-slider-blocks-frontend.js',
		[ 'splide' ],
		hd_slider_blocks_asset_ver( 'assets/js/hd-slider-blocks-frontend.js' ),
		true
	);
} );

/**
 * Editor: register the variation, attribute filter, and sidebar controls.
 */
add_action( 'enqueue_block_editor_assets', function (): void {
	$url = plugin_dir_url( __FILE__ );

	wp_enqueue_script(
		'hd-slider-blocks-editor',
		$url . 'assets/js/hd-slider-blocks-editor.js',
		[ 'wp-hooks', 'wp-blocks', 'wp-block-editor', 'wp-components', 'wp-compose', 'wp-element', 'wp-i18n' ],
		hd_slider_blocks_asset_ver( 'assets/js/hd-slider-blocks-editor.js' ),
		true
	);
	wp_enqueue_style(
		'hd-slider-blocks-editor',
		$url . 'assets/css/hd-slider-blocks-editor.css',
		[],
		hd_slider_blocks_asset_ver( 'assets/css/hd-slider-blocks-editor.css' )
	);
} );

/**
 * Transforms the saved HTML of a slider-enabled core/group into Splide's
 * required DOM (outer .splide > .splide__track > .splide__list > li.splide__slide).
 *
 * The group's original wrapper (with its alignment, background, padding etc.)
 * is kept — we just add the .splide class + data-splide options, and replace
 * its children with a Splide list re-rendered from $block['innerBlocks'].
 */
add_filter( 'render_block_core/group', function ( string $block_content, array $block ): string {
	if ( empty( $block['attrs']['isSlider'] ) ) {
		return $block_content;
	}

	$options = hd_slider_blocks_options( $block['attrs'] );

	// Pull the original outer tag's class + style so we can preserve the
	// group's alignment / background / spacing on the new wrapper.
	$outer_class = '';
	$outer_style = '';
	$processor   = new WP_HTML_Tag_Processor( $block_content );
	if ( $processor->next_tag() ) {
		$outer_class = (string) $processor->get_attribute( 'class' );
		$outer_style = (string) $processor->get_attribute( 'style' );
	}
	if ( ! str_contains( $outer_class, 'splide' ) ) {
		$outer_class = trim( $outer_class . ' splide' );
	}
	// Blocks saved before the arrow placement option existed carry no
	// placement class, so add the resolved one when the save has not.
	if ( ! str_contains( $outer_class, $options['arrow_class'] ) ) {
		$outer_class = trim( $outer_class . ' ' . $options['arrow_class'] );
	}

	$slides_html = '';
	foreach ( (array) ( $block['innerBlocks'] ?? [] ) as $inner_block ) {
		$slides_html .= '<li class="splide__slide">' . render_block( $inner_block ) . '</li>';
	}

	$data_html = '';
	foreach ( hd_slider_blocks_data_attributes( $options ) as $name => $value ) {
		$data_html .= sprintf( ' %s="%s"', $name, esc_attr( $value ) );
	}

	return sprintf(
		'<div class="%s" style="%s"%s><div class="splide__track"><ul class="splide__list">%s</ul></div></div>',
		esc_attr( $outer_class ),
		esc_attr( $outer_style ),
		$data_html,
		$slides_html
	);
}, 10, 2 );

/**
 * Relabels a slider-enabled Query Loop's post list as Splide's track and list.
 *
 * Unlike a group, a Query Loop's slides do not exist until core/post-template
 * renders them, so this hangs off the template rather than the query. The
 * markup core already outputs — <ul class="wp-block-post-template"> wrapping
 * <li class="wp-block-post"> items — is the structure Splide wants under a
 * different set of class names, so nothing is rebuilt, only renamed and wrapped.
 */
add_filter( 'render_block_core/post-template', function ( string $block_content, array $block, WP_Block $instance ): string {
	if ( empty( $instance->context['hdSlider/isSlider'] ) ) {
		return $block_content;
	}

	$processor = new WP_HTML_Tag_Processor( $block_content );
	if ( ! $processor->next_tag( array( 'tag_name' => 'ul' ) ) ) {
		return $block_content;
	}

	$processor->add_class( 'splide__list' );

	// Splide lays the track out itself; the block's own layout fights it.
	$processor->remove_class( 'is-layout-flex' );
	$processor->remove_class( 'is-layout-grid' );
	$processor->remove_class( 'is-layout-constrained' );

	// Only the template's own items carry wp-block-post, so lists inside post
	// content are left alone.
	while ( $processor->next_tag( array( 'tag_name' => 'li' ) ) ) {
		if ( str_contains( (string) $processor->get_attribute( 'class' ), 'wp-block-post' ) ) {
			$processor->add_class( 'splide__slide' );
		}
	}

	return '<div class="splide__track">' . $processor->get_updated_html() . '</div>';
}, 10, 3 );

/**
 * Marks a slider-enabled Query Loop's wrapper as the Splide root.
 *
 * The track and list are built by the core/post-template filter above, so this
 * only has to add the class and options the frontend script reads. Any sibling
 * the query renders (pagination, no-results) stays inside the root, where
 * Splide ignores it and the stylesheet hides it.
 */
add_filter( 'render_block_core/query', function ( string $block_content, array $block ): string {
	if ( empty( $block['attrs']['isSlider'] ) ) {
		return $block_content;
	}

	$processor = new WP_HTML_Tag_Processor( $block_content );
	if ( ! $processor->next_tag() ) {
		return $block_content;
	}

	$options = hd_slider_blocks_options( $block['attrs'] );

	$processor->add_class( 'splide' );
	$processor->add_class( $options['arrow_class'] );

	foreach ( hd_slider_blocks_data_attributes( $options ) as $name => $value ) {
		$processor->set_attribute( $name, $value );
	}

	return $processor->get_updated_html();
}, 10, 2 );
