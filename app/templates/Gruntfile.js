/*global module, require */
/*jshint camelcase: false */

module.exports = function (grunt) {
    'use strict';

    // show elapsed time at the end
    require('time-grunt')(grunt);
    // load all grunt tasks
    require('load-grunt-tasks')(grunt);

    // configurable paths
    var yeomanConfig = {
            src: 'src',
            app: 'src/app',
            dist: 'dist',
            www: 'dist/www',
            tmp: '.tmp',
            components: '<%= bowerComponents %>'
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
                src: ['<%%= yeoman.src %>/**/*.js', '<%%= yeoman.src %>/**/*.json']
            }
        },
        jslint: {
            gruntfile: {
                src: '<%%= jshint.gruntfile.src %>'
            },
            src: {
                src: '<%%= yeoman.src %>/**/*.js'
            }
        },
        csslint: {
            lax: {
                options: {
                    'import': false
                },
                src: ['<%%= yeoman.src %>/**/*.css']
            }
        },
        htmlhint: {
            options: {
                'id-unique': true,
                'tag-pair': true,
                'spec-char-escape': true,
                'attr-value-not-empty': true,
                'attr-value-double-quotes': true,
                'attr-lowercase': true,
                'style-disabled': true
            },
            html: {
                src: ['<%%= yeoman.src %>/**/*.html']
            }
        },
        watch: {
            livereload: {
                options: {
                    livereload: LIVERELOAD_PORT
                },
                files: [
                    '<%%= yeoman.app %>/**'
                ]
            },
            gruntfile: {
                files: '<%%= jshint.gruntfile.src %>',
                tasks: ['jshint:gruntfile']
            },
            src: {
                options: {
                    livereload: LIVERELOAD_PORT
                },
                files: '<%%= yeoman.app %>/**',
                tasks: ['lint']
            },
            dist: {
                options: {
                    livereload: LIVERELOAD_PORT
                },
                files: '<%%= yeoman.app %>/**',
                tasks: ['build']
            }
        },
        dojo: {
            dist: {
                options: {
                    profile: 'profiles/app.profile.js', // Profile fobuild
                    appConfigFile: './<%%= yeoman.app %>/config.json', // Optional: Config file for dojox/app
                    releaseDir: '<%%= yeoman.tmp %>'
                }
            },
            options: {
                // You can also specify options to be used in all your tasks
                dojo: '<%%= yeoman.components %>/dojo/dojo.js', // Path to dojo.js file in dojo source
                load: 'build' // Optional: Utiltbootstrap (Default:
            }
        },
        copy: {
            web: {
                expand: true,
                cwd: '<%%= yeoman.tmp %>',
                src: [
                    'app/views/css/app.css',
                    'app/views/images/**',
                    'app/main.js',
                    'app/nls/main*.js',
                    'dojox/mobile/themes/custom/custom.css',
                    'dojo/dojo.js', 'build-report.txt'
                ],
                dest: '<%%= yeoman.www %>'
            },
            web_index: {
                files: [
                    {
                        expand: true,
                        flatten: true,
                        cwd: 'src',
                        src: ['dist-index.html'],
                        dest: '<%%= yeoman.www %>',
                        rename: function (dest) {
                          // use the source directory to create the file
                          // example with your directory structure
                          //   dest = 'dist/www/'
                          //   src = 'dist-index.html'
                            return dest + '/index.html';
                        }
                    }
                ]
            },
            web_dojox_app_hack: {
                //This is really nasty hack, but dojox/app come empty from repo becasue of git submodules
                // the contents is located in another repo and it MUST be copy over
                files: [
                    {
                        expand: true,
                        cwd: '<%%= yeoman.components %>/dojox_application',
                        src: ['**'],
                        dest: '<%%= yeoman.components %>/dojox/app'
                    }
                ]
            }
        },
        clean: {
            dist: {
                files: [{
                    dot: true,
                    src: [
                        '<%%= yeoman.tmp %>',
                        '<%%= yeoman.dist %>'
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
                            lrSnippet,
                            mountFolder(connect, yeomanConfig.www)
                        ];
                    }
                }
            }
        },
        open: {
            server: {
                path: 'http://localhost:<%%= connect.options.port %>/src/index.html'
            },
            dist: {
                path: 'http://localhost:<%%= connect.options.port %>'
            }
        }
    });


    // Default task.
    grunt.registerTask('default', ['server']);

    //Linting tasks
    grunt.registerTask('lint', ['cpdxapp', 'jshint', 'jslint', 'csslint', 'htmlhint']);
    //web dev tasks
    grunt.registerTask('web_build', ['lint', 'dojo', 'copy:web_index', 'copy:web']);
    //main build tasks
    grunt.registerTask('build_all', ['web_build']);

    grunt.registerTask('build', function (target) {
        if (target === 'all') {
            grunt.task.run(['build_all']);
        } else if (target === 'dist' || target === 'web') {
            grunt.task.run(['web_build']);
        } else {
            grunt.task.run(['web_build']);
        }
    });
    //livereload server tasks server or server:dist
    grunt.registerTask('server', function (target) {
        if (target === 'dist' || target === 'web') {
            grunt.task.run([
                'build:web',
                'connect:dist',
                'open:dist',
                'watch:dist'
            ]);
        } else {
            grunt.task.run([
                'lint',
                'connect:livereload',
                'open:server',
                'watch:src'
            ]);
        }
    });


    //<%= yeoman.components %>/dojox_application needs to be present in <%= yeoman.components %>/dojox/app
    grunt.task.registerTask('cpdxapp', 'Copies dojox_application to dojox/app', function () {
        var check;

        check = (yeomanConfig.components + '/dojox/app/main.js');

        if (grunt.file.exists(check)) {
            grunt.log.writeln(check + ' exists, no copy necessary');
        } else {
            grunt.log.writeln(check + ' does not exists, doing copy');
            grunt.task.run(['copy:web_dojox_app_hack']);
        }

    });

};