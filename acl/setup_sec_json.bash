#!/bin/bash
echo "Usage: setup_sec_json <node.js program name> <SVR .json file>"
echo "Should be called with the current working directory in the js scripts folder"
echo "Edit the variable JSON2CBOR to point to the path where iotivity-node is installed"
JSON2CBOR="~/iotivity-node/iotivity-installed/bin/json2cbor" 

WFILE=$PWD"/"$1
#echo $WFILE
folder_name=`echo -n $WFILE| sha256sum|awk -F ' ' '{print $1}'`

mkdir -p ~/.iotivity-node/$folder_name
echo -n "Created folder:" 
echo ~/.iotivity-node/$folder_name

eval $JSON2CBOR $2 ~/.iotivity-node/$folder_name/oic_svr_db.dat

#copy original file to folder just for reference
cp $2 ~/.iotivity-node/$folder_name/

