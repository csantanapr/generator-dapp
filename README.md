
# generator-dapp [![Build Status](https://secure.travis-ci.org/csantanapr/generator-dapp.png?branch=master)](https://travis-ci.org/csantanapr/generator-dapp)

A generator for dapp (dojox/app) .


## Getting Started

### What is Yeoman?

Trick question. It's not a thing. It's this guy:

![](http://i.imgur.com/JHaAlBJ.png)

Basically, he wears a top hat, lives in your computer, and waits for you to tell him what kind of application you wish to create.

Not every new computer comes with a Yeoman pre-installed. He lives in the [npm](https://npmjs.org) package repository. You only have to ask for him once, then he packs up and moves into your hard drive. *Make sure you clean up, he likes new and shiny things.*

```
$ npm install -g yo
```

### Yeoman Generators

Yeoman travels light. He didn't pack any generators when he moved in. You can think of a generator like a plug-in. You get to choose what type of application you wish to create, such as a Backbone application or even a Chrome extension.

To install generator-dapp from npm, run:

```
$ npm install -g generator-dapp
```

Finally, initiate the generator:

```
$ yo dapp
```

- The Dapp Generator is a set of files to help you rapidly get up and running a SPA
- Helps you build your SPA which some times consumes a lot of time when starting a new SPA
- The SPA provides optional creation of Hybrid App using [Apache Cordova/PhoneGap](http://cordova.io)


----

Development (Use Grunt to preview, lint, build)
===
Use grunt to run tasks, for more available tasks run `grunt --help`

### Preview Source with watch and livereload
    grunt server

### Preview Distribution with watch and livereload
    grunt server:dist

### Lint
    grunt lint

### Build
Be happy, and stop crying because you can't figure out how to build dojo or create a hybrid App as fast and simple as it should be.

Believe me I cried a lot :-(

    grunt build

### Optional: Hybrid App (Apache Cordova/PhoneGap)
See [Yeoman Dude Generator](http://github.com/csantanapr/generator-dude)


----


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


Change Log
---
See [CHANGELOG.md](CHANGELOG.md)

License
--
[LICENSE.md](LICENSE.md)

TODO
---

- Integrate Continues Integration (CI)
  - Add unit tests (i.e. Jasmine or Mocha)
  - Add functional testing (Webdriver API)
  - Run Unit and Functional Testing using [The Intern](https://github.com/theintern/intern) leveraging the [ Intern Tutorial](https://github.com/theintern/intern-tutorial)
- Sub-Generators
  - dapp:view
  - dapp:controller
  - dapp:store

