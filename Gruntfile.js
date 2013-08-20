/*global module, require */

module.exports = function (grunt) {
    'use strict';
    // load all grunt tasks
    require('matchdep').filterDev('grunt-*').forEach(grunt.loadNpmTasks);

    // configurable paths
    var yeomanConfig = {
            src: 'src',
            app: 'src/app',
            dist: 'dist',
            www: 'dist'
        },
        LIVERELOAD_PORT = 35729,
        lrSnippet = require('connect-livereload')({port: LIVERELOAD_PORT}),
        mountFolder = function (connect, dir) {
            return connect['static'](require('path').resolve(dir));
        };

    // Project configuration.
    grunt.initConfig({
        // Metadata.
        yeoman: yeomanConfig,
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
            livereload: {
                options: {
                    livereload: LIVERELOAD_PORT
                },
                files: [
                    '<%= yeoman.src %>/**'
                ]
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
            app_index: {
                files: [
                    {
                        expand: true,
                        flatten: true,
                        cwd: 'src',
                        src: ['dist-index.html'],
                        dest: 'dist/www/',
                        rename: function (dest) {
                          // use the source directory to create the file
                          // example with your directory structure
                          //   dest = 'dist/www/'
                          //   src = 'dist-index.html'
                            return dest + 'index.html';
                        }
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
            },
            dojox_app_hack: {
                //This is really nasty hack, but dojox/app come empty from repo becasue of git submodules
                // the contents is located in another repo and it MUST be copy over
                files: [
                    {
                        expand: true,
                        cwd: 'components/dojox_application',
                        src: ['**'],
                        dest: 'components/dojox/app'
                    }
                ]
            }
        },
        clean: {
            dist: {
                files: [{
                    dot: true,
                    src: [
                        '<%= yeoman.dist %>/*',
                        '!<%= yeoman.dist %>/.git*'
                    ]
                }]
            }
        },
        connect: {
            options: {
                port: 9000,
                // change this to '0.0.0.0' or '*' to access the server from outside
                hostname: 'localhost'
            },
            livereload: {
                options: {
                    middleware: function (connect) {
                        return [
                            lrSnippet,
                            mountFolder(connect, '.')
                        ];
                    }
                }
            },
            dist: {
                options: {
                    middleware: function (connect) {
                        return [
                            mountFolder(connect, yeomanConfig.www)
                        ];
                    }
                }
            }
        },
        open: {
            server: {
                path: 'http://localhost:<%= connect.options.port %>/src/index.html'
            },
            dist: {
                path: 'http://localhost:<%= connect.options.port %>'
            }
        }
    });


    // Default task.

    grunt.registerTask('lint', ['jshint', 'jslint']);
    grunt.registerTask('build', ['lint', 'copy:dojox_app_hack', 'dojo', 'copy']);
    grunt.registerTask('default', ['build']);
    grunt.registerTask('server', function (target) {
        if (target === 'dist') {
            return grunt.task.run(['build', 'open:dist', 'connect:dist:keepalive']);
        }

        grunt.task.run([
            'connect:livereload',
            'open:server',
            'watch'
        ]);
    });

};