#!/bin/sh

appname=suspendtab

cp buildscript/makexpi.sh ./
./makexpi.sh -n $appname
rm ./makexpi.sh

