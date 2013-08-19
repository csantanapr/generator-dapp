#!/usr/bin/env bash

set -x
date1=$(date +"%s")

# Base directory for this entire project
BASEDIR=$(cd $(dirname $0) && pwd)

#Update path for dependencies
PATH="${BASEDIR}/node_modules/.bin::${PATH}"

# Source directory for unbuilt code
SRCDIR="$BASEDIR/src"

#JS Components (bower or volo)
JSLIBS="$BASEDIR/components"

# Directory containing dojo build utilities
TOOLSDIR="$JSLIBS/util/buildscripts"

# Main application package build configuration
PROFILE="$BASEDIR/profiles/app.profile.js"

#App Framework Config File
APPCONFIG="$SRCDIR/app/config.json"

# Destination directory for built code
DIST_DIR="$BASEDIR/dist"

# Destination directory for built code
TMP_BUILD_DIR="$DIST_DIR/.build"

# Destination directory for built code
DIST_WWW_DIR="$DIST_DIR/www"

# Configuration over. Main application start up!

if [ ! -d "$TOOLSDIR" ]; then
    echo "Can't find Dojo build tools -- did you initialise submodules? (git submodule update --init --recursive)"
    exit 1
fi

echo "Hack to move dojox_application to dojox/app"
cp -af ${JSLIBS}/dojox_application/ ${JSLIBS}/dojox/app/

echo "Building application with $PROFILE to $TMP_BUILD_DIR."

cd "$TOOLSDIR"

if which node >/dev/null; then
    echo "running node ../../dojo/dojo.js load=build --profile "$PROFILE" --releaseDir "$TMP_BUILD_DIR" --appConfigFile "$APPCONFIG" $@"
    node ../../dojo/dojo.js load=build --profile "$PROFILE" --releaseDir "$TMP_BUILD_DIR" --appConfigFile "$APPCONFIG" $@
    echo "************************If you see this line the build Did NOT blew up**************************"
elif which java >/dev/null; then
    echo "The build produce errors when running with java, I recommend installing node"
    echo "When using Java to build dojo error 303 for html files being inserted to layer will show up: "
    echo "error(303) Missing include module for layer."
    echo "missing: app/views/app.html; layer: app/main"
    echo "missing: app/views/view1/view1.html; layer: app/main"
    echo ""
    echo "Please install and use node to build dojo is much faster than Java and also I want to you to smile"
    echo ""
    echo "If you have a good reason to build dojo using java uncomment the next line in this script"
    echo "java -Xms256m -Xmx256m  -cp ../shrinksafe/js.jar:../closureCompiler/compiler.jar:../shrinksafe/shrinksafe.jar org.mozilla.javascript.tools.shell.Main  ../../dojo/dojo.js baseUrl=../../dojo load=build --profile "$PROFILE" --releaseDir "$TMP_BUILD_DIR" --appConfigFile "$APPCONFIG" $@"

    #java -Xms256m -Xmx256m  -cp ../shrinksafe/js.jar:../closureCompiler/compiler.jar:../shrinksafe/shrinksafe.jar org.mozilla.javascript.tools.shell.Main  ../../dojo/dojo.js baseUrl=../../dojo load=build --profile "$PROFILE" --releaseDir "$TMP_BUILD_DIR" --appConfigFile "$APPCONFIG" $@
    exit 1
else
    echo "Need node.js or Java to build!"
    exit 1
fi

echo "Dojo build done: $TMP_BUILD_DIR"
cd "$BASEDIR"

#Create Distribution
mkdir -p "$DIST_WWW_DIR"

# Copy Build Report
cp "$TMP_BUILD_DIR/build-report.txt" "$DIST_WWW_DIR/"

# Copy index.html
cp -a "$SRCDIR/index.html" "$DIST_WWW_DIR/index.html"

#index.html
cp -a "$TMP_BUILD_DIR/index.html" "$DIST_WWW_DIR"

##############Copy App stuff###########################
mkdir -p "$DIST_WWW_DIR/app/nls"
mkdir -p "$DIST_WWW_DIR/app/views/css"
mkdir -p "$DIST_WWW_DIR/app/views/images"
mkdir -p "$DIST_WWW_DIR/app/resources/data/rest"

#css
cp -a "$TMP_BUILD_DIR/app/views/css/app.css" "$DIST_WWW_DIR/app/views/css/"

#images
cp -a "$TMP_BUILD_DIR/app/views/images" "$DIST_WWW_DIR/app/views/"

#js My App (app/main) layer (contains js, html, and config.json)
cp -af $TMP_BUILD_DIR/app/main.*               $DIST_WWW_DIR/app/
rm -rf $DIST_WWW_DIR/app/*.consoleStripped.js


#nls files
cp -af $TMP_BUILD_DIR/app/nls/main*.js             $DIST_WWW_DIR/app/nls/
rm -f $DIST_WWW_DIR/app/nls/*.consoleStripped.js
rm -f $DIST_WWW_DIR/app/nls/*.uncompressed.js

#json
cp -a "$TMP_BUILD_DIR/app/resources/data/rest" "$DIST_WWW_DIR/app/resources/data"

##############Copy View 1 stuff (Optional)####################################
#Just in case there are static files specific to view1 and not other views1
#Showing this as an example, normal case images should go in views/app/images/
mkdir -p "$DIST_WWW_DIR/app/views/view1"
#images
cp -a "$TMP_BUILD_DIR/app/views/view1/images" "$DIST_WWW_DIR/app/views/view1/"

##############Copy Dojo stuff###########################
mkdir -p "$DIST_WWW_DIR/dojo"
mkdir -p "$DIST_WWW_DIR/dojox/mobile/themes/android"
mkdir -p "$DIST_WWW_DIR/dojox/mobile/themes/iphone"
mkdir -p "$DIST_WWW_DIR/dojox/mobile/themes/blackberry"
mkdir -p "$DIST_WWW_DIR/dojox/mobile/themes/holodark"
mkdir -p "$DIST_WWW_DIR/dojox/mobile/themes/windows"
mkdir -p "$DIST_WWW_DIR/dojox/mobile/themes/custom"

#css dojo
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/android/android.css"       "$DIST_WWW_DIR/dojox/mobile/themes/android/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/iphone/iphone.css"         "$DIST_WWW_DIR/dojox/mobile/themes/iphone/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/iphone/ipad.css"           "$DIST_WWW_DIR/dojox/mobile/themes/iphone/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/blackberry/blackberry.css" "$DIST_WWW_DIR/dojox/mobile/themes/blackberry/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/holodark/holodark.css"     "$DIST_WWW_DIR/dojox/mobile/themes/holodark/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/windows/windows.css"       "$DIST_WWW_DIR/dojox/mobile/themes/windows/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/custom/custom.css"         "$DIST_WWW_DIR/dojox/mobile/themes/custom/"

#images dojo
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/android/images"      "$DIST_WWW_DIR/dojox/mobile/themes/android/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/iphone/images"       "$DIST_WWW_DIR/dojox/mobile/themes/iphone/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/blackberry/images"   "$DIST_WWW_DIR/dojox/mobile/themes/blackberry/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/holodark/images"     "$DIST_WWW_DIR/dojox/mobile/themes/holodark/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/windows/images"      "$DIST_WWW_DIR/dojox/mobile/themes/windows/"
cp -a "$TMP_BUILD_DIR/dojox/mobile/themes/custom/images"       "$DIST_WWW_DIR/dojox/mobile/themes/custom/"

#js dojo layer
cp -a $TMP_BUILD_DIR/dojo/dojo.js*       $DIST_WWW_DIR/dojo/
rm -f $DIST_WWW_DIR/dojo/*.consoleStripped.js


echo "Copy App distribution done: $DIST_WWW_DIR"
date2=$(date +"%s")
diff=$(($date2-$date1))
echo "$(($diff / 60)) minutes and $(($diff % 60)) seconds elapsed."

echo "Build completed: $(($diff / 60)) minutes and $(($diff % 60)) seconds"
