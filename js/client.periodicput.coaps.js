// Copyright 2019 Campie Project @Cairo University
// Based on iotivity-node/js/client.get.coaps.js
// Copyright 2016 Intel Corporation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var intervalId,
    postIntervalId,
    handleReceptacle = {},

    // This is the same value as server.get.js

    postUpdtCount = 0,
    iotivity = require("iotivity-node/lowlevel"),
    resourceMissing = true;

if (process.argv.length < 4) {
    console.log("Missing parameters. Add the URI to post to and post operations count");
    process.exit(1);
}

var sampleUri = process.argv[2];
var updtCount = parseInt(process.argv[3]);
if (updtCount === 0)
    updtCount = 20; //default



console.log("Starting OCF stack in client mode: periodic post client");

console.log("Updating: " + sampleUri + " for " + updtCount + " times");

iotivity.OCRegisterPersistentStorageHandler(require("../node_modules/iotivity-node/lib/StorageHandler")());

// Start iotivity and set up the processing loop
iotivity.OCInit(null, 0, iotivity.OCMode.OC_CLIENT_SERVER);

intervalId = setInterval(function() {
    iotivity.OCProcess();
}, 1000);

function assembleRequestUrl(eps, path) {
    var endpoint;
    var endpointIndex;
    var result;
    for (endpointIndex in eps) {
        endpoint = eps[endpointIndex];
        if (endpoint.tps === "coaps") {
            result = (endpoint.tps + "://" +
                (endpoint.family & iotivity.OCTransportFlags.OC_IP_USE_V6 ? "[" : "") +
                endpoint.addr.replace(/[%].*$/, "") +
                (endpoint.family & iotivity.OCTransportFlags.OC_IP_USE_V6 ? "]" : "") +
                ":" + endpoint.port) + path;
            //console.log( "GET request to " + result );
            return result;
        }
    }
    throw new Error("No secure endpoint found!");
}

console.log("Issuing discovery request");



// Discover resources and list them
iotivity.OCDoResource(

    // The bindings fill in this object
    handleReceptacle,

    iotivity.OCMethod.OC_REST_DISCOVER,

    // Standard path for discovering resources
    iotivity.OC_MULTICAST_DISCOVERY_URI,

    // There is no destination
    null,

    // There is no payload
    null,
    iotivity.OCConnectivityType.CT_DEFAULT,
    iotivity.OCQualityOfService.OC_HIGH_QOS,
    function(handle, response) {
        console.log("Received response to DISCOVER request:");
        //console.log( JSON.stringify( response, null, 4 ) );

        issuePostRequest(response);
        return iotivity.OCStackApplicationResult.OC_STACK_KEEP_TRANSACTION;
    },
    // There are no header options
    null);

var myResource;

function issuePostRequest(discoverResponse) {
    var index,
        resources = discoverResponse && discoverResponse.payload && discoverResponse.payload.resources,
        postHandleReceptacle = {},

        resourceCount = resources ? resources.length : 0,
        postResponseHandler = function(handle, response) {
            console.log("Received response to PUT/POST request:");
            console.log(JSON.stringify(response.payload.values, null, 4));
            return iotivity.OCStackApplicationResult.OC_STACK_DELETE_TRANSACTION;
        };

    console.log("Resource count from discover request " + resourceCount);

    // If the sample URI is among the resources, issue the PUT request to it
    for (index = 0; index < resourceCount; index++) {
        if (resources[index].uri === sampleUri) {
            myResource = resources[index];
            console.log("posting for resource:" + myResource.uri + " anchor: " + myResource.anchor);
            postIntervalId = setInterval(function() {
                if (postUpdtCount < updtCount) {
                    postUpdtCount++;
                    console.log("Issuing post request# " + postUpdtCount + " for " + myResource.uri);
                    iotivity.OCDoResource(
                        postHandleReceptacle,
                        iotivity.OCMethod.OC_REST_POST,
                        assembleRequestUrl(myResource.eps, sampleUri),
                        null, {
                            type: iotivity.OCPayloadType.PAYLOAD_TYPE_REPRESENTATION,
                            values: {
                                id: "Mqtt_Service",
                                value: "OCFTestRandomString" + String(Math.round(Math.random() * 1000))
                            }
                        },
                        iotivity.OCConnectivityType.CT_DEFAULT,
                        iotivity.OCQualityOfService.OC_HIGH_QOS,
                        postResponseHandler,
                        null);
                    return iotivity.OCStackApplicationResult.OC_STACK_KEEP_TRANSACTION;
                } else { //enough updates
                    clearInterval(postIntervalId);
                    return iotivity.OCStackApplicationResult.OC_STACK_DELETE_TRANSACTION;
                }
            }, 4000); //periodic function call each 2 seconds
        } //if smaple uri
    } //for
}

// Exit gracefully when interrupted
process.on("SIGINT", function() {
    console.log("SIGINT: Quitting...");

    // Tear down the processing loop and stop iotivity
    clearInterval(intervalId);
    iotivity.OCStop();

    // Exit
    process.exit(0);
});