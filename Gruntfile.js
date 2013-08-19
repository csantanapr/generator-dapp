/*global module */

module.exports = function (grunt) {
    'use strict';

    // Project configuration.
    grunt.initConfig({
        // Metadata.
        jshint: {
            gruntfile: {
                src: 'Gruntfile.js'
            },
            src: {
                src: ['src/**/*.js']
            }
        },
        jslint: {
            gruntfile: {
                src: '<%= jshint.gruntfile.src %>'
            },
            src: {
                src: '<%= jshint.src.src %>'
            }
        },
        watch: {
            gruntfile: {
                files: '<%= jshint.gruntfile.src %>',
                tasks: ['jshint:gruntfile', 'jslint:gruntfile']
            },
            src: {
                files: '<%= jshint.src.src %>',
                tasks: ['jshint:src', 'jslint:src']
            }
        }
    });
    // These plugins provide necessary tasks.
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-jslint');
    grunt.loadNpmTasks('grunt-contrib-watch');

    // Default task.
    grunt.registerTask('default', ['jshint', 'jslint']);

};