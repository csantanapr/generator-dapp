/*global require */
/**
 * This is the default application build profile used by the boilerplate. While it looks similar, this build profile
 * is different from the package build profile at `app/package.js` in the following ways:
 *
 * 1. you can have multiple application build profiles (e.g. one for desktop, one for tablet, etc.), but only one
 *    package build profile;
 * 2. the package build profile only configures the `resourceTags` for the files in the package, whereas the
 *    application build profile tells the build system how to build the entire application.
 *
 * Look to `util/build/buildControlDefault.js` for more information on available options and their default values.
 */
require(["dojox/app/build/buildControlApp"], function (bc) {'use strict'; });

var profile = {
    // `basePath` is relative to the directory containing this profile file; in this case, it is being set to the
    // src/ directory, which is the same place as the `baseUrl` directory in the loader configuration. (If you change
    // this, you will also need to update run.js.)
    basePath: '../',

    // nls handling
    //localeList: 'en,en-us,en-gb,es,es-es',
    localeList: 'ar,ca,cs,da,de,el,en,en-gb,en-us,es,es-es,fi,fi-fi,fr,fr-fr,he,he-il,hu,it,it-it,ja,ja-jp,ko,ko-kr,nl,nl-nl,nb,pl,pt,pt-br,pt-pt,ru,sk,sl,sv,th,tr,zh,zh-tw,zh-cn',


    // This is the directory within the release directory where built packages will be placed. The release directory
    // itself is defined by `build.sh`. You should probably not use this; it is a legacy option dating back to Dojo
    // 0.4.
    // If you do use this, you will need to update build.sh, too.
    // releaseName: '',

    // Builds a new release.
    action: 'release',

    // Strips all comments and whitespace from CSS files and inlines @imports where possible.
    cssOptimize: 'comments',

    // Excludes tests, demos, and original template files from being included in the built version.
    mini: true,

    // Uses Closure Compiler as the JavaScript minifier. This can also be set to "shrinksafe" to use ShrinkSafe,
    // though ShrinkSafe is deprecated and not recommended.
    // This option defaults to "" (no compression) if not provided.
    //set to false for faster builds only building layers
    optimize: false,

    // We're building layers, so we need to set the minifier to use for those, too.
    // This defaults to "shrinksafe" if not provided.
    // Set to uglify for faster builds
    layerOptimize: 'uglify',

    // Strips all calls to console functions within the code. You can also set this to "warn" to strip everything
    // but console.error, and any other truthy value to strip everything but console.warn and console.error.
    // This defaults to "normal" (strip all but warn and error) if not provided.
    stripConsole: 'all',

    // The default selector engine is not included by default in a dojo.js build in order to make mobile builds
    // smaller. We add it back here to avoid that extra HTTP request. There is also a "lite" selector available; if
    // you use that, you will need to set the `selectorEngine` property in `app/run.js`, too. (The "lite" engine is
    // only suitable if you are not supporting IE7 and earlier.)
    selectorEngine: 'lite',

    packages: [
        // If you are registering a package that has an identical name and location, you can just pass a string
        // instead, and it will configure it using that string for both the "name" and "location" properties. Handy!
        //'dojo',
        //'dijit',
        //'dojox',
        { name: 'dojo', location: 'components/dojo'},
        { name: 'dijit', location: 'components/dijit'},
        { name: 'dojox', location: 'components/dojox'},


        // For reference, this is what a more verbose package declaration looks like.
        { name: 'app', location: 'src/app', map: {} }
    ],

    // Builds can be split into multiple different JavaScript files called "layers". This allows applications to
    // defer loading large sections of code until they are actually required while still allowing multiple modules to
    // be compiled into a single file.
    layers: {
        //IMPORTANT make sure the first layer is the one that will get the modules from config.json by default
        //appConfigFile adds config.json modules to first layer
        "app/main": {
            //any dependencies for module app/main.js get discover and added to this layer
            include: [
                "app/main"
            ]
        }
    },
    // Providing hints to the build system allows code to be conditionally removed on a more granular level than
    // simple module dependencies can allow. This is especially useful for creating tiny mobile builds.
    // Keep in mind that dead code removal only happens in minifiers that support it! Currently, only Closure Compiler
    // to the Dojo build system with dead code removal.
    // A documented list of has-flags in use within the toolkit can be found at
    // <http://dojotoolkit.org/reference-guide/dojo/has.html>.
    staticHasFeatures: {
        // The trace & log APIs are used for debugging the loader, so we do not need them in the build.
        'dojo-trace-api': 0,
        'dojo-log-api': 0,

        // This causes normally private loader data to be exposed for debugging. In a release build, we do not need
        // that either.
        'dojo-publish-privates': 0,

        // This application is pure AMD, so get rid of the legacy loader.
        'dojo-sync-loader': 0,

        // `dojo-xhr-factory` relies on `dojo-sync-loader`, which we have removed.
        'dojo-xhr-factory': 0,

        // We are not loading tests in production, so we can get rid of some test sniffing code.
        'dojo-test-sniff': 0,


        //Below features for mobile optimized

        "dojo-amd-factory-scan": true,


        // Other configuration switches that are hardcoded in the source.
        // Setting some of these to false may reduce code size, but unclear what they all mean.
        "dojo-debug-messages": false,
        "dojo-gettext-api": true,           // apparently unused
        "dojo-loader-eval-hint-url": true,



        // Browser flags
        "webkit": true, // this is actually a number like 525 but I don't think anyone is using it
        "air": false,
        "ff": undefined,
        "mozilla": undefined,
        "ie": undefined,

        // Configuration settings
        //"config-selectorEngine": "lite",
        "dijit-legacy-requires": false,     // don't load unrequested modules for back-compat
        "dom-quirks": false,                // we assume/require that the app is in strict mode
        "quirks": false,                    // we assume/require that the app is in strict mode

        // Flags for old IE browser bugs / non-standard behavior
        "array-extensible": true,       // false for old IE
        "bug-for-in-skips-shadowed": 0, // false for old IE
        "dom-attributes-explicit": true,    // everyone except IE6, 7
        "dom-attributes-specified-flag": true,  //everyone except IE6-8
        "dom-addeventlistener": true,       // everyone except IE
        "native-xhr": true,         // has XMLHTTPRequest
        "ie-event-behavior": undefined,
        "dojo-force-activex-xhr": false,    // true is for IE path

        // Flags for features
        "dom-matches-selector": true,
        "dom-qsa": true,
        "dom-qsa2.1": true,
        "dom-qsa3": true,
        "json-parse": true,
        "json-stringify": true,

        // Behavior that varies by browser, but is constant across webkit mobile browsers
        "events-keypress-typed": true,      // whether printable characters generate keypress event?
        "events-mouseenter": false,     // this is set by mouse.html but never used
        "touch": true,
        "highcontrast": false,          // safari always displays background images, even when device in high-contrast mode
        "textarea-needs-help-shrinking": true,
        "css-user-select": "'WebkitUserSelect'"
    }
};
