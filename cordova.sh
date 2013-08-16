#!/usr/bin/env bash

set -x
date1=$(date +"%s")

# Base directory for this entire project
BASEDIR=$(cd $(dirname $0) && pwd)

#Update path for dependencies
PATH="${BASEDIR}/node_modules/.bin::${PATH}"

# Destination directory for built code
DIST_DIR="$BASEDIR/dist"

# Source directory for unbuilt code
DIST_WWW_DIR="$DIST_DIR/www"

# Destination directory for built code
CDV_DIST_DIR="$DIST_DIR/cordova"

# Destination directory for built code
CDV_APP_PATH="$CDV_DIST_DIR/dApp"

# Destination directory for built code
CDV_DIST_WWW_DIR="$CDV_APP_PATH/www"

rm -rf $CDV_APP_PATH

cordova create $CDV_APP_PATH

cp -a $DIST_WWW_DIR/ $CDV_DIST_WWW_DIR/

cd $CDV_APP_PATH

cordova platform add ios

cordova platform add android



cordova build

date2=$(date +"%s")
diff=$(($date2-$date1))
echo "Cordova build completed: $(($diff / 60)) minutes and $(($diff % 60)) seconds"

# To Run local web server
cordova serve ios
#cordova serve android

# To Run on Simulator
#echo "Quit Simulator or Ctrl + C to exit"
#cordova emulate ios
#cordova emulate android

# To Run on Physical Device
#cordova run ios
#cordova run android

echo "To Run on Simulator or Device edit cordova.sh"






