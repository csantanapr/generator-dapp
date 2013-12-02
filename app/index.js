/*jslint nomen: true */
/*global require, module, __dirname, console*/
var util = require('util');
var path = require('path');
var yeoman = require('yeoman-generator');

var DappGenerator;
DappGenerator = module.exports = function DappGenerator(args, options) {
    'use strict';
    yeoman.generators.Base.apply(this, arguments);

    this.on('end', function () {
        this.installDependencies({ skipInstall: options['skip-install'] });
    });

    this.pkg = JSON.parse(this.readFileAsString(path.join(__dirname, '../package.json')));

    this.bowerComponents = JSON.parse(this.readFileAsString(path.join(__dirname, 'templates', '_.bowerrc'))).directory;
};

util.inherits(DappGenerator, yeoman.generators.Base);

DappGenerator.prototype.askFor = function askFor() {
    'use strict';
};

DappGenerator.prototype.app = function app() {
    'use strict';
    this.directory('profiles', 'profiles');
    this.directory('src', 'src');
};

DappGenerator.prototype.projectfiles = function projectfiles() {
    'use strict';
    this.copy('editorconfig', '.editorconfig');
    this.template('_package.json', 'package.json');
    this.template('_bower.json', 'bower.json');
    this.template('Gruntfile.js');
    this.copy('_.bowerrc', '.bowerrc');
    this.template('_.gitignore', '.gitignore');
    this.template('_LICENSE', 'LICENSE');
};
