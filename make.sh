#!/bin/sh

appname=suspendtab

cp makexpi/makexpi.sh ./
./makexpi.sh -n $appname -o
rm ./makexpi.sh

