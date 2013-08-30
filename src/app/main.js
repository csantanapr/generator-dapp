/*global alert, define*/

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

    // for some reason appConfig.loaderConfig.paths.app set to ../src/app when running from source
    if (dojoConfig.baseUrl && dojoConfig.paths && dojoConfig.paths.app) {
        if (appConfig.loaderConfig && appConfig.loaderConfig.paths && appConfig.loaderConfig.paths.app) {
            appConfig.loaderConfig.paths.app = dojoConfig.baseUrl + dojoConfig.paths.app;
        }
    }
    // populate has flag on whether html5 history is correctly supported or not
    has.add("html5history", !has("ie") || has("ie") > 9);

    //Start the App
    dApp(appConfig);


});