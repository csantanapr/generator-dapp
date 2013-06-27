#!/usr/bin/env bash

set -e

# Base directory for this entire project
BASEDIR=$(cd $(dirname $0) && pwd)

# Source directory for unbuilt code
SRCDIR="$BASEDIR/src"

# Directory containing dojo build utilities
TOOLSDIR="$SRCDIR/util/buildscripts"

# Destination directory for built code
DISTDIR="$BASEDIR/dist"

# Main application package build configuration
PROFILE="$BASEDIR/profiles/app.profile.js"

#App Framework Config File
APPCONFIG="$SRCDIR/app/config.json"

# Configuration over. Main application start up!

if [ ! -d "$TOOLSDIR" ]; then
	echo "Can't find Dojo build tools -- did you initialise submodules? (git submodule update --init --recursive)"
	exit 1
fi

echo "Building application with $PROFILE to $DISTDIR."

echo -n "Cleaning old files..."
rm -rf "$DISTDIR"
echo " Done"

cd "$TOOLSDIR"

if which node >/dev/null; then
    echo "running node ../../dojo/dojo.js load=build --profile "$PROFILE" --releaseDir "$DISTDIR" --appConfigFile "$APPCONFIG" $@"
	node ../../dojo/dojo.js load=build --profile "$PROFILE" --releaseDir "$DISTDIR" --appConfigFile "$APPCONFIG" $@
    echo "************************If you see this line the build didn't blew up**************************"
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
    echo "java -Xms256m -Xmx256m  -cp ../shrinksafe/js.jar:../closureCompiler/compiler.jar:../shrinksafe/shrinksafe.jar org.mozilla.javascript.tools.shell.Main  ../../dojo/dojo.js baseUrl=../../dojo load=build --profile "$PROFILE" --releaseDir "$DISTDIR" --appConfigFile "$APPCONFIG" $@"
    
    #java -Xms256m -Xmx256m  -cp ../shrinksafe/js.jar:../closureCompiler/compiler.jar:../shrinksafe/shrinksafe.jar org.mozilla.javascript.tools.shell.Main  ../../dojo/dojo.js baseUrl=../../dojo load=build --profile "$PROFILE" --releaseDir "$DISTDIR" --appConfigFile "$APPCONFIG" $@
    exit 1
else
	echo "Need node.js or Java to build!"
	exit 1
fi

cd "$BASEDIR"

# Copy & and disable debug
cat "$SRCDIR/index.html" | \
perl -pe "
  s/isDebug: 1/isDebug: 0/;                           # Remove isDebug" > "$DISTDIR/index.html"
#s/\s+/ /g;                                 # Collapse white-space" > "$DISTDIR/index.html"

#Create Mini App for Mobile Development

# Destination directory for built code
MOBILE_DISTDIR="$BASEDIR/mobile/www"
echo -n "Cleaning mobile Mobile Output"
rm -rf "$MOBILE_DISTDIR"
echo " Done"
mkdir -p "$MOBILE_DISTDIR"
cp -a "$DISTDIR/index.html" "$MOBILE_DISTDIR"
#copy app to pick up css, template html files, 1 per language app/nls/main_en-us.js, and 1 layer file main.js
cp -a "$DISTDIR/app" "$MOBILE_DISTDIR"
#create dojo stuff
mkdir -p "$MOBILE_DISTDIR/dojo"

#copy 1 dojo file and smile :-)
cp -a "$DISTDIR/dojo/dojo.js"  "$MOBILE_DISTDIR/dojo/dojo.js"




echo "Build complete"
