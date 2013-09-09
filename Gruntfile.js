/*global module, require */

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
            tmp: 'dist/.build',
            cordova_path: 'dist/cordova/dApp'
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
                src: ['<%= yeoman.src %>/**/*.js', '<%= yeoman.src %>/**/*.json']
            }
        },
        jslint: {
            gruntfile: {
                src: '<%= jshint.gruntfile.src %>'
            },
            src: {
                src: '<%= yeoman.src %>/**/*.js'
            }
        },
        csslint: {
            lax: {
                options: {
                    'import': false
                },
                src: ['<%= yeoman.src %>/**/*.css']
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
                src: ['<%= yeoman.src %>/**/*.html']
            }
        },
        watch: {
            livereload: {
                options: {
                    livereload: LIVERELOAD_PORT
                },
                files: [
                    '<%= yeoman.app %>/**'
                ]
            },
            gruntfile: {
                files: '<%= jshint.gruntfile.src %>',
                tasks: ['jshint:gruntfile']
            },
            src: {
                files: '<%= yeoman.app %>/**',
                tasks: ['lint']
            }
        },
        dojo: {
            dist: {
                options: {
                    profile: 'profiles/app.profile.js', // Profile fobuild
                    appConfigFile: './<%= yeoman.app %>/config.json', // Optional: Config file for dojox/app
                    releaseDir: '<%= yeoman.tmp %>'
                }
            },
            options: {
                // You can also specify options to be used in all your tasks
                dojo: 'components/dojo/dojo.js', // Path to dojo.js file in dojo source
                load: 'build' // Optional: Utiltbootstrap (Default:
            }
        },
        copy: {
            web: {
                expand: true,
                cwd: '<%= yeoman.tmp %>',
                src: [
                    'app/views/css/app.css',
                    'app/views/images/**',
                    'app/main.js',
                    'app/nls/main*.js',
                    'dojox/mobile/themes/custom/custom.css',
                    'dojo/dojo.js', 'build-report.txt'
                ],
                dest: '<%= yeoman.www %>'
            },
            web_index: {
                files: [
                    {
                        expand: true,
                        flatten: true,
                        cwd: 'src',
                        src: ['dist-index.html'],
                        dest: '<%= yeoman.www %>',
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
                        cwd: 'components/dojox_application',
                        src: ['**'],
                        dest: 'components/dojox/app'
                    }
                ]
            },
            cordova: {
                files: [
                    {
                        expand: true,
                        cwd: '<%= yeoman.www %>',
                        src: '**',
                        dest: '<%= yeoman.cordova_path %>/www/'
                    }
                ]
            }
        },
        cordovacli: {
            options: {
                path: '<%= yeoman.cordova_path %>'
            },
            create: {
                options: {
                    command: 'create',
                    id: 'com.myHybridApp', //optional
                    name: 'myHybridApp'    //optional
                }
            },
            platform: {
                options: {
                    command: 'platform',
                    action: 'add',                  //valid actions for command platform are add , remove, rm
                    platforms: ['ios', 'android']          //valid platforms for command platform are ios, android, blackberry10, wp8, wp7
                }
            },
            build: {
                options: {
                    command: 'build',
                    platforms: ['ios', 'android']
                }
            },
            emulate_ios: {
                options: {
                    command: 'emulate',
                    platforms: ['ios']
                }
            },
            emulate_android: {
                options: {
                    command: 'emulate',
                    platforms: ['android']
                }
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
            },
            cordova: {
                files: [{
                    dot: true,
                    src: [
                        '<%= yeoman.cordova_path %>/*',
                        '!<%= yeoman.cordova_path %>/.git*'
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

    //Linting tasks
    grunt.registerTask('lint', ['jshint', 'jslint', 'csslint', 'htmlhint']);
    //web dev tasks
    grunt.registerTask('web_build', ['lint', 'cpdxapp', 'dojo', 'copy:web_index', 'copy:web']);
    //main build tasks
    grunt.registerTask('build', ['web_build']);
    grunt.registerTask('build_all', ['web_build', 'cordova']);
    grunt.registerTask('default', ['build']);
    //livereload server tasks server or server:dist
    grunt.registerTask('server', function (target) {
        if (target === 'dist') {
            return grunt.task.run(['web_build', 'open:dist', 'connect:dist:keepalive']);
        }

        grunt.task.run([
            'cpdxapp',
            'lint',
            'connect:livereload',
            'open:server',
            'watch'
        ]);
    });
    //Apache Cordova tasks
    grunt.registerTask('cordova_create', ['clean:cordova', 'cordovacli:create', 'cordovacli:platform']);
    grunt.registerTask('cordova_build', ['copy:cordova', 'cordovacli:build']);
    grunt.registerTask('cordova', ['cordova_create', 'cordova_build']);
    grunt.registerTask('cordova_emulate', ['cordova_build', 'cordovacli:emulate_ios', 'cordovacli:emulate_android']);


    //components/dojox_application needs to be present in components/dojox/app
    grunt.task.registerTask('cpdxapp', 'Copies dojox_application to dojox/app', function () {
        var check;

        check = "components/dojox/app/main.js";

        if (grunt.file.exists(check)) {
            grunt.log.writeln(check + " exists, no copy necessary");
        } else {
            grunt.log.writeln(check + " does not exists, doing copy ");
            grunt.task.run(['copy:web_dojox_app_hack']);
        }

    });

};