Dojo App Boilerplate: A Starter Kit for Dojo Development using Single Page DojoX/App Framework
====================================================

- The Dojo App Boilerplate is a set of files to help you rapidly get up and running with the Dojo Toolkit and dojox/app mvc framework. 
- It illustrates some basic best practices when working with Dojo based on the original work of [dojo-boilerplate](https://github.com/csnover/dojo-boilerplate).
- Helps you build dojo which is some time the most dificult of working with [dojotoolkit](dojotoolkit.org)
- Builds an alternate small build to be embedded in a mobile App like [Apache Cordova/PhoneGap](cordova.io)
- Huge thanks go out to [csnover](https://github.com/csnover) and the other contributors for the original [dojo-boilerplate](https://github.com/csnover/dojo-boilerplate) project. 


Quick Start
-----------

0. Clone the repository using `git clone --recursive`.
1. Develop your project in `src/` until it is amazing.
2. Run `build.sh`, which will create an awesome optimized build in `dist/`.
3. Upload `dist/` for millions of people the world over to enjoy.
4. Use `mobile/www` to create an awesome Hybrid Mobile App with [Apache Cordova/PhoneGap](cordova.io)
4. Happiness, and stop crying because you can't figure out how to build dojo

### Windows Users

If you have [msysgit](http://git-scm.com) installed, run Git Bash and verify
some dependencies by running the following commands:

    which node
    which java

If at least `node` is available, you're ready to go; `cd` to your project
directory and follow the Quick Start instructions above. If Java is missing,
you will need to install it. Node.js is optional, but will reward you with
much faster builds.

A brief tour
------------

* The starting point of the boilerplate is the file at `src/index.html` for
  the client, and `src/server.sh` for a server running Node.js. These files
  are responsible for loading the Dojo loader and the application’s
  bootstrapper script.
* The file `src/app/run.js` is your application’s bootstrapper script. In
  it, you can configure paths, packages, and other configuration options
  that should apply to both the client and the server. By default, this file
  simply configures paths and packages and then loads `src/app/main.js`
  (by way of the second `[ 'app' ]` argument).
* The file `build.sh` takes your application files and builds them for
  production use using the Dojo build tool. It depends on the presence of the
  build profile at `profiles/app.profile.js`.
* The file `src/app/resources/app.css` contains import statements to load
  the CSS . 
* The App creates an instance of `dojox/app/main` using the App Controller Configuration File  `src/app/config.json`
* Add Views, View Controllers, and Object Stores (Model) starting by modifying the config.json
* The provider directory structure for css, html, and js for your App is defined in config.json the provided one is just an example

Useful resources
----------------

* [Dojox/App Tutorial](http://dojotoolkit.org/documentation/tutorials/1.9/dojox_app)
* [Dojox/App Reference](http://dojotoolkit.org/reference-guide/dojox/app.html#dojox-app)
* [Dojo Reference Guide](http://dojotoolkit.org/reference-guide/)
* [Dojo API Browser](http://dojotoolkit.org/api/)

About the boilerplate
---------------------

- This project started because I always spent a few weeks getting started with a new version of Dojo, and use this as a learning exercise to get to know the Web Project Dojo/App which i know some of the folks that work on it.
- This boilerplate is constantly updated to try to reflect the latest and
greatest features and design patterns for writing Web apps with Dojo, but
it relies heavily on information and contributions from other users. If
you have an idea, suggestion, or problem, please [report
it](https://github.com/csantanapr/dojo-app-boilerplate/issues) or create a pull
request! (Please note that you will need to have signed the [Dojo
CLA](http://dojofoundation.org/about/cla) before your pull requests are
accepted, for the good of us all!)

Future
---

- Basic boilerplate to create App generator/scalfolder for other projects:
    - [Yoeman](http://yeoman.io)
    - [IBM Worklight](http://ibm.com/mobilefirst)
    - [Apache Cordova CLI](http://cordova.io)
- Examples on how to integrate Dojox/App with other Projects:
    - [Handlebars](http://handlebarsjs.com)
    - [JQuery](http://jquery.com)
    - [Jasmine](http://pivotal.github.com/jasmine)
    - [The Intern](http://theintern.io)
    - [NodeJS](http://nodejs.org)
    - [NPM](https://npmjs.org)
    - [Grunt](http://gruntjs.com)
    - [MongoDB](http://www.mongodb.org)
- Education resources
    - Screencasts
    - Tutorials

License
-------

The Dojo App Boilerplate is licensed under the [same
terms](https://github.com/dojo/dojo/blob/master/LICENSE) as the Dojo
Toolkit. Consult the individual projects (see the Useful resources section
above) for additional licensing information.
