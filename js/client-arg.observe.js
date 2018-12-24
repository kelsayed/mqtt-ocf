// Copyright 2019 Campie Project @Cairo University
// Based on iotivity-node/js/client.observe.js
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
	handleReceptacle = {},

	// This is the same value as server.get.js
	//sampleUri = "/a/iotivity-node-observe-sample",
	//sampleUri = "/a/hrm",
	//sampleUri= "/a/hrm/ef4eb89335f7/180d",
	//sampleUri="/a/bpm/ef4eb89335f7/1810",
	//sampleUri="/a/bas/ef4eb89335f7/180f",
	observerResponseCount = 0,
	iotivity = require( "iotivity-node/lowlevel" ),
	resourceMissing = true;

if (process.argv.length < 4){
	console.log("Missing parameters. Add the URI to observe and observe count");
	process.exit( 1 );
}
var sampleUri=process.argv[2];
var observeCount=parseInt(process.argv[3]);
if (observeCount === 0)
	observeCount = 20; //default

console.log("Observing: " + sampleUri + "for " + observeCount + " times");

function assembleRequestUrl( eps, path ) {
	var endpoint;
	var endpointIndex;
	var result;
	for ( endpointIndex in eps ) {
		endpoint = eps[ endpointIndex ];
		if ( endpoint.tps  === "coaps" ) {
			result = ( endpoint.tps + "://" +
				( endpoint.family & iotivity.OCTransportFlags.OC_IP_USE_V6 ? "[" : "" ) +
				endpoint.addr.replace( /[%].*$/, "" ) +
				( endpoint.family & iotivity.OCTransportFlags.OC_IP_USE_V6 ? "]" : "" ) +
				":" + endpoint.port ) + path;
			console.log( "GET request to " + result );
			return result;
		}
	}
	throw new Error( "No secure endpoint found!" );
}
	
// Start iotivity and set up the processing loop
iotivity.OCRegisterPersistentStorageHandler( require( "../node_modules/iotivity-node/lib/StorageHandler" )() );
iotivity.OCInit( null, 0, iotivity.OCMode.OC_CLIENT_SERVER);

intervalId = setInterval( function() {
	iotivity.OCProcess();
}, 1000 );

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
	function( handle, response ) {
		console.log( "Received response to DISCOVER request:" );
		console.log( JSON.stringify( response, null, 4 ) );
		var index,
			destination = response.addr,
			observeHandleReceptacle = {},
			resources = response && response.payload && response.payload.resources,
			resourceCount = resources ? resources.length : 0,
			observeResponseHandler = function( handle, response ) {
				console.log( "Received response to OBSERVE request:" );
				console.log( JSON.stringify( response, null, 4 ) );
				if ( observerResponseCount++ >= observeCount ) {
					console.log( "Enough observations. Calling OCCancel()" );
					iotivity.OCCancel(
						handle,
						iotivity.OCQualityOfService.OC_HIGH_QOS,
						null );
					return iotivity.OCStackApplicationResult
						.OC_STACK_DELETE_TRANSACTION;
				} else {
					return iotivity.OCStackApplicationResult.OC_STACK_KEEP_TRANSACTION;
				}
			};

		if ( resourceMissing ) {

			// If the sample URI is among the resources, issue the OBSERVE request to it
			for ( index = 0; index < resourceCount; index++ ) {
				if ( resources[ index ].uri == sampleUri ) {
					resourceMissing = false;

					console.log( "Observing " + sampleUri );

					iotivity.OCDoResource(
						observeHandleReceptacle,
						iotivity.OCMethod.OC_REST_OBSERVE,
						assembleRequestUrl( resources[ index ].eps, sampleUri),
						destination,
						null,
						iotivity.OCConnectivityType.CT_ADAPTER_IP|iotivity.OCConnectivityType.CT_FLAG_SECURE,
						iotivity.OCQualityOfService.OC_HIGH_QOS,
						observeResponseHandler,
						null );
				}
			}
		}

		return iotivity.OCStackApplicationResult.OC_STACK_KEEP_TRANSACTION;
	},

	// There are no header options
	null );

// Exit gracefully when interrupted
process.on( "SIGINT", function() {
	console.log( "SIGINT: Quitting..." );

	// Tear down the processing loop and stop iotivity
	clearInterval( intervalId );
	iotivity.OCStop();

	// Exit
	process.exit( 0 );
} );
