/*jslint nomen: true */
/*global describe, beforeEach, it, require, __dirname*/


var path    = require('path');
var helpers = require('yeoman-generator').test;


describe('dapp generator', function () {
    'use strict';
    beforeEach(function (done) {
        helpers.testDirectory(path.join(__dirname, 'temp'), function (err) {
            if (err) {
                return done(err);
            }

            this.app = helpers.createGenerator('dapp:app', [
                '../../app'
            ]);
            done();
        }.bind(this));
    });

    it('creates expected files', function (done) {
        var expected = [
            // add files you expect to exist here.
            '.bowerrc',
            '.editorconfig',
            '.gitignore',
            'bower.json',
            'Gruntfile.js',
            'package.json',
            'profiles/app.profile.js',
            'src/index.html',
            'src/app/config.json'
        ];

        helpers.mockPrompt(this.app, {
            'appName': 'dapp'
        });
        this.app.options['skip-install'] = true;
        this.app.run({}, function () {
            helpers.assertFiles(expected);
            done();
        });
    });
});
