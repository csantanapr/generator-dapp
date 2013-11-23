#### Version 0.3.0
- Replace with yeoman generator


#### Version 0.2.3
- update grunt-cordovacli to 0.1.7
- simplified bower.json

#### Version 0.2.2
- fix grunt server task to skip copy dojox_application if already present in dojox/app


#### Version 0.2.1
- Skip copy dojox_application if already present in dojox/app
- Added ability to print times for grunt

#### Version 0.2.0
- Replace complex App with more simple App Sample (old code is located in [dapp-examples](https://github.com/csantanapr/dapp-examples) )

#### Version 0.1.8
- Replace cordova.sh with [grunt-cordovacli](https://npmjs.org/package/grunt-cordovacli) plugin

#### Version 0.1.7
- Fix mising npm dependency matchdep
- Fix added copy_dojox_hack as part of grunt server task

#### Version 0.1.6
- Fix build dist nls files not copied
- Fix grunt server:dist task

#### Version 0.1.5
- Implemented Initial support for [Grunt](http://gruntjs.com)

#### Version 0.1.4
- Implemented JS lib dependencies using components with bower or volo

#### Version 0.1.3
- Added Android platform as default in cordova.sh

#### Version 0.1.2
- Fix Build Scripts to include local path
- Fix npm package.json to include uglify-js
- Updated Readme to indicate user to run `npm install`

#### Version 0.1.0
- Build Scripts
  - Fast dojo builds using uglifyjs
  - Small Distribution output
  - National Language Support (i18n)
- Example App with dojox/app features
  - View Templates (HTML)
  - View Controller (JS)
  - Transitions (CSS3 hardware accelerated)
  - JQuery Style syntax for DOM and Events
  - Object Stores Stores (Memory, MongoDB-JSONREST)
  - Dojo Mobile UI
- Integration with new Apache Cordova 3.0 CLI