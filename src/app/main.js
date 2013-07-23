/*global define, console*/
/*jslint todo: true */
/*jshint todo: true */

/**
 * This file is the application's main JavaScript file. It is listed as a dependency in run.js and will automatically
 * load when run.js loads.
 *
 * Because this file has the special filename `main.js`, and because we've registered the `app` package in run.js,
 * whatever object this module returns can be loaded by other files simply by requiring `app` (instead of `app/main`).
 *
 * Our first dependency is to the `dojo/has` module, which allows us to conditionally execute code based on
 * configuration settings or environmental information. Unlike a normal conditional, these branches can be compiled
 * away by the build system; see `staticHasFeatures` in app.profile.js for more information.
 *
 * Our second dependency is to the special module `require`; this allows us to make additional require calls using
 * module IDs relative to this module within the body of the define callback.
 *
 * In all cases, whatever function is passed to define() is only invoked once, and the returned value is cached.
 *
 * More information about everything described about the loader throughout this file can be found at
 * <http://dojotoolkit.org/reference-guide/loader/amd.html>.
 */
define([
    'dojo/_base/window',
    'dojo/sniff',
    'require',
    'dojox/app/main',
    'dojox/json/ref',
    'dojo/text!app/config.json',
    'dojo/text!app/resources/data/items.json',
    //TODO: add all html templates being use in config.json to force them to be included in layer
    // when doing custom dojo build, the build process will recognize them as dependencies for the package
    'dojo/text!app/views/app.html',
    'dojo/text!app/views/view1/view1.html',
    'dojo/text!app/views/view2/view2.html',
    'dojo/domReady!'
], function (win, has, require, Application, json, config, data) {
    'use strict';
    win.global.myapp = {};

    // populate has flag on whether html5 history is correctly supported or not
    has.add("html5history", !has("ie") || has("ie") > 9);

    //TODO: Just for debugging this enables built in logging
    //has.add("app-log-api", true);

    // setup the data for the memory stores
    win.global.myapp.dataItems = json.fromJson(data);

    //Start the App
    win.global.myapp.App = new Application(json.fromJson(config));

});
