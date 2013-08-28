/*global define, console*/

/**
 * Bootstrap dApp Application
 **/

define([
    'dojo/sniff',
    'dojox/app/main',
    'dojox/json/ref',
    'dojo/text!app/config.json',
    'dojo/_base/config',
    'dojo/domReady!'
], function (has, dApp, json, config, dojoConfig) {
    'use strict';
    var appConfig = json.fromJson(config);

    if (dojoConfig.isDebug) {
        //really a hack, need tofix this and make more flexible
        appConfig.loaderConfig.paths.app = "../src/app";
    }

    // populate has flag on whether html5 history is correctly supported or not
    has.add("html5history", !has("ie") || has("ie") > 9);

    //Start the App
    dApp(appConfig);


});