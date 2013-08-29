A Starter Kit for SPA (Single Page Apps)
===

- The Boilerplate is a set of files to help you rapidly get up and running a SPA
- Helps you build your SPA which some times consumes a lot of time when starting a new SPA
- The SPA provides optional creation of Hybrid App using [Apache Cordova/PhoneGap](http://cordova.io)

Installing
===
### Download Project

Download [https://github.com/csantanapr/dapp-boilerplate/archive/master.zip](https://github.com/csantanapr/dapp-boilerplate/archive/master.zip)
    
    cd dapp-boilerplate

### Install CLI Dependencies

Use  [NPM](http://npmjs.org):

    npm install

Downloads cli dependencies to `node_modules/`

### Install Browser Dependencies
Use [Bower](http://bower.io) or [Volo](http://volojs.org)

    bower install
    or
    volo install

Downloads browser dependencies to `components/`

----

Development (Use Grunt to preview, lint, build)
===
Use grunt to run tasks, for more available tasks run `grunt --help`

### Preview Source with watch and liverelaod
    grunt server

### Preview Distribution
    grunt server:dist

### Lint
    grunt lint

### Build
Be happy, and stop crying because you can't figure out how to build dojo or create a hybrid App as fast and simple as it should be.

Believe me I cried a lot :-(

    grunt build

### Optional: Hybrid App (Apache Cordova/PhoneGap)

To build web and cordova run:

    grunt build_all

To run Simulators (Apple iOS, Android) run:

    grunt cordova_emulate

To run just Apple iOS Simulator run:

    grunt cordovacli:emualte_ios

To run just Android Simulator run:

    grunt cordovacli:emualte_android

----

### Windows Users

If you have [msysgit](http://git-scm.com) installed, run Git Bash and verify
some dependencies by running the following commands:

    which node

Node will reward you with much faster builds.

## A brief tour
 

* The starting point of the boilerplate is the file at `src/index.html` and `src/app/main.js`
  It's responsible for loading the Dojo loader and the application’s
  bootstrapper with `config.json`
* The task `grunt build` takes your application files and builds them for
  production using the Dojo build tool.
  * It depends on the presence of the build profile at `profiles/app.profile.js` and App config `src/app/config.json`
* The App creates an instance of `dojox/app/main` using the App Controller Configuration File  `src/app/config.json`
* The provided directory structure for css, html, and js for your App is defined in config.json, you can change to a different convention

# Examples
This boilerplate provides a very basic sample mobile App using using dojox.mobile widgets

For more advanced examples including integration with other JavaScript Libraries (jquery, backbone, angular, nodes, mongodb, handlebars, etc.. ) checkout this repo:

## [dapp-examples](https://github.com/csantanapr/dapp-examples)

----


Useful resources
----------------

* [Dojox/App Tutorial](http://dojotoolkit.org/documentation/tutorials/1.9/dojox_app) @ [dojotoolkit.org](http://dojotoolkit.org)
* [Dojox/App Reference](http://dojotoolkit.org/reference-guide/dojox/app.html#dojox-app) @ [dojotoolkit.org](http://dojotoolkit.org)

About the boilerplate
---------------------

- This project started because I always spent a few weeks getting started with a new version of Dojo, and want to give a try to the MV* dApp Framework.
- This boilerplate is constantly updated to try to reflect the latest and
greatest features and design patterns for developing Single Page App, but
it relies heavily on information and contributions from other users.
- If you have an idea, suggestion, or problem, please [report
it](https://github.com/csantanapr/dojo-app-boilerplate/issues) or create a pull
request! (Please note that you will need to have signed the [Dojo
CLA](http://dojofoundation.org/about/cla) before your pull requests are
accepted, for the good of us all!)

Change Log
---
See [CHANGELOG.md](CHANGELOG.md)


Future
---

- Integrate Continues Integration (CI)
  - Add unit tests (i.e. Jasmine or Mocha)
  - Add functional testing (Webdriver API)
  - Run Unit and Functional Testing using [The Intern](https://github.com/theintern/intern) leveraging the [ Intern Tutorial](https://github.com/theintern/intern-tutorial)
- Basic boilerplate to create App generator/scaffolding for other platforms:
  - [Yoeman](http://yeoman.io)
  - [IBM Worklight](http://ibm.com/mobilefirst)
- Education resources on [dApp website](http://csantanapr.github.io/dapp-boilerplate)
  - Screencasts
  - Tutorials

Dual License
--
The dApp Boilerplate is licensed under the [same
terms](https://github.com/dojo/dojo/blob/master/LICENSE) as the Dojo
Toolkit.

* [BSD](https://github.com/dojo/dojo/blob/master/LICENSE#L13)
* [AFLv2.1](https://github.com/dojo/dojo/blob/master/LICENSE#L43)


Thanks
---
- Huge thanks go out to [csnover](https://github.com/csnover) and the other contributors for the original [dojo-boilerplate](https://github.com/csnover/dojo-boilerplate) project.
