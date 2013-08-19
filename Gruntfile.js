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
            options: {
                livereload: true
            },
            gruntfile: {
                files: '<%= jshint.gruntfile.src %>',
                tasks: ['jshint:gruntfile', 'jslint:gruntfile']
            },
            src: {
                files: '<%= jshint.src.src %>',
                tasks: ['jshint:src', 'jslint:src']

            }
        },
        dojo: {
            dist: {
                options: {
                    profile: 'profiles/app.profile.js', // Profile fobuild
                    appConfigFile: './src/app/config.json', // Optional: Config filfor dojox/app
                    releaseDir: 'dist/.build'
                }
            },
            options: {
                // You can also specify options to be used in all your tasks
                dojo: 'components/dojo/dojo.js', // Path to dojo.js file in dojo source
                load: 'build' // Optional: Utiltbootstrap (Default:
            }
        },
        copy: {
            app: {
                files: [
                    {
                        expand: true,
                        cwd: 'src',
                        src: ['index.html'],
                        dest: 'dist/www/'
                    }
                ]
            },
            app_css: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: ['app/views/css/app.css'],
                        dest: 'dist/www/'
                    }
                ]
            },
            app_images: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: ['app/views/images/**'],
                        dest: 'dist/www/'
                    }
                ]
            },
            app_js: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: ['app/main.js'],
                        dest: 'dist/www/'
                    }
                ]
            },
            app_nls: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: ['app/main*.js'],
                        dest: 'dist/www/'
                    }
                ]
            },
            app_data: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: ['app/resources/data/**'],
                        dest: 'dist/www/'
                    }
                ]
            },
            app_view1: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: ['app/views/view1/images/**'],
                        dest: 'dist/www/'
                    }
                ]
            },
            dojo_themes: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: [
                            'dojox/mobile/themes/android/android.css',
                            'dojox/mobile/themes/iphone/iphone.css',
                            'dojox/mobile/themes/iphone/ipad.css',
                            'dojox/mobile/themes/blackberry/blackberry.css',
                            'dojox/mobile/themes/holodark/holodark.css',
                            'dojox/mobile/themes/windows/windows.css',
                            'dojox/mobile/themes/custom/custom.css'
                        ],
                        dest: 'dist/www/'
                    },
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: [
                            'dojox/mobile/themes/android/images/**',
                            'dojox/mobile/themes/iphone/images/**',
                            'dojox/mobile/themes/blackberry/images/**',
                            'dojox/mobile/themes/holodark/images/**',
                            'dojox/mobile/themes/windows/images/**',
                            'dojox/mobile/themes/custom/images/**'
                        ],
                        dest: 'dist/www/'
                    }
                ]
            },
            dojo: {
                files: [
                    {
                        expand: true,
                        cwd: 'dist/.build',
                        src: ['dojo/dojo.js', 'build-report.txt'],
                        dest: 'dist/www/'
                    }
                ]
            }
        }
    });
    // These plugins provide necessary tasks.
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-jslint');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-dojo');
    grunt.loadNpmTasks('grunt-contrib-copy');

    // Default task.

    grunt.registerTask('lint', ['jshint', 'jslint']);
    grunt.registerTask('build', ['lint', 'dojo', 'copy']);
    grunt.registerTask('default', ['build']);

};