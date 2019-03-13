// Copyright 2019 Campie Project @Cairo University
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

/*jslint node: true */
"use strict";

const myutil = require('util');
var debuglog = myutil.debuglog('ble-ocf-bridge');

var noble = require('noble');
var exitHandlerBound = false;

//Array of BLE peripherals
var peripherals = [];

//increase as allowed by underlying BLE chipset
var maxPeripherals = 4;

//Add supported services here
var serviceUuids = ['180d', '1810', '180f'];

//OCF related variables
var
    result,
    processLoop = null,
    processCallCount = 0,
    processLoopProceed = true,
    iotivity = require("iotivity-node/lowlevel"),
    ocfDevice = require('iotivity-node'),
    rdServerAddress,
    rdRegisterMode = false,
    proceedWithRD = false;

/* The Central Structure: oicResources resources to create to handle he services. It is indexed by peripheral.uuid. 
    It contains: 
	//Todo: add resource itself and read handler if needed
	rsrc: the resource created by IoTivity
	serviceUuid: serviceUuid,
	peripheralID: peripheralId,
	oicSensorData:   per sensor/device data
	hasUpdate : does the resource have new data to send to observers
	observeHandler: observation/periodic read handler
	observerCount: how many observer clients are there				
*/

var oicResources = [];
var oicResourceCount = 0; //the number of created resources

/* ObserverWrapper: Common class for handling notifications for all types of services */
class ObserverWrapper {
    constructor(resource, interval, getProperties) {
        //debuglog("=====================================> Creating new observer for " + JSON.stringify(resource, null, 4));
        this.resource = resource;
        this.interval = interval;
        this.getProperties = getProperties;
        this.observerCount = 0;
        this.intervalId = 0;
    }

    addObserver() {
        if (this.observerCount === 0) {
            var resource = this.resource;
            var getter = this.getProperties;
            var interv = 1000 * this.interval;
            this.intervalId = setInterval(function() {
                //var rsrcIndex = getDeviceUUID(resource.deviceId);
                var rsrcIndex = getResourceID(resource);
                resource.properties = getter(rsrcIndex, resource.resourceTypes[0]);
                //resource.outputValue = Math.round( Math.random() * 42 ) + 1;
                //debuglog("Observer: " + rsrcIndex + " Has Update: " + resource.properties.hasUpdate + "  ==>output: " +  JSON.stringify(resource.properties, null, 4 ));
                if (oicResources[rsrcIndex].hasUpdate) {
                    resource.notify();
                    oicResources[rsrcIndex].hasUpdate = false;
                    //oicResources[rsrcIndex].hasUpdate = true; //always update for testing only
                }
            }, interv);
        }
        this.observerCount++;
    }

    removeObserver() {
        this.observerCount--;
        if (this.observerCount <= 0) {
            debuglog("Turning off interval for " + JSON.stringify(this.resource.resourcePath, null, 4));
            clearInterval(this.intervalId);
            this.observerCount = 0;
            this.intervalId = 0;
        }
    }
}
/*---------------------End of class ---------------------------------*/

/* Initilaize Iotivity Stack and main Ocprocess loop */
debuglog("=========> Creating OCF Device: ");

ocfDevice.device = Object.assign(ocfDevice.device, {
    name: 'BLE OCF Bridge',
    coreSpecVersion: 'core.1.1.0',
    dataModels: ['res.1.1.0']
});

ocfDevice.platform = Object.assign(ocfDevice.platform, {
    manufacturerName: 'Campie_CU',
    manufactureDate: new Date('Mon Sep 10 12:00:00 (GMT) 2018'),
    platformVersion: '1.1.0',
    firmwareVersion: '0.0.1'
});

result = iotivity.OCInit(null, 0, iotivity.OCMode.OC_CLIENT_SERVER);
console.log("OCIinit returned with", result);


processLoop = setInterval(function() {
    //console.log('Going in the periodic OCProcess loop. Process Count:' + processCallCount);

    var processResult = iotivity.OCProcess();


    if (processResult === iotivity.OCStackResult.OC_STACK_OK) {
        processCallCount++;
    } else {
        debuglog("BLE_Bridge: OCProcess (after " + processCallCount + " successful calls). Result: ", processResult);
    }
    if (processLoopProceed === false) {
        clearInterval(processLoop);
        console.log(' No more iotivity.OcProces() --> Leaving Bye!');
    }
}, 1000);

function rdMode(argv) {
    if (argv.length < 3)
        return false; //default
    else {
        var mode = parseInt(process.argv[2]);
        if (mode === 0)
            return false;
        else //1 or any other value, then register with RD
            return true;
    }
}

rdRegisterMode = rdMode(process.argv);
console.log("rdRegsiterMode=", rdRegisterMode);
if (rdRegisterMode)
    DiscoverRD();


/*--------------------------- Discover  BLE device ---------------*/
var discover = function(peripheral) {
    //if (peripheral.advertisement.localName && peripheral.advertisement.localName.indexOf('Nordic_HRM') > -1) //all devices with KH_HRM name, remove in the future
    if (true) {
        console.log("(scan)found:" + peripheral.advertisement.localName + " - UUID: " + peripheral.uuid);

        peripheral.connect(connect.bind({
            peripheral: peripheral
        }));
    }
};

/*--------------------------- Connect to device and discover services ---------------*/
var connect = function(err) {
    if (err) throw err;
    console.log("Connection to " + this.peripheral.uuid)
    peripherals[peripherals.length] = this.peripheral;

    if (peripherals.length >= maxPeripherals) {
        console.log("Stopping BLE scan. Reached " + maxPeripherals + " peripherals");
        noble.stopScanning();
    }

    if (!exitHandlerBound) //initially false, we do this only once
    {
        exitHandlerBound = true;
        process.on('SIGINT', exitHandler);
    }

    this.peripheral.discoverServices([], setupService);
};


/*--------------------------- Setup BLE services: HRM, BPM, BAT ---------------*/
var setupService = function(err, services) {
    if (err) throw err;
    services.forEach(function(service) {
        if (service.uuid === '180d') { // add if for each service found by scan
            debuglog("Found HRM UUID");
            var characteristicUUIDs = ['2a37', '2a38', '2a39'];
            //2a37: BT_UUID_HRS_MEASUREMENT 
            //2a38: BT_UUID_HRS_BODY_SENSOR 
            //2a39: BT_UUID_HRS_CONTROL_POINT 
            service.discoverCharacteristics(characteristicUUIDs, function(error, characteristics) {
                debuglog("Got characteristics " + characteristics);
                oicHrmInitService(characteristics[0]);
            });
        }

        if (service.uuid === '1810xxx') { // add if for each service found by scan
            //if(service.uuid === '1810'){// add if for each service found by scan
            debuglog("Found Blood Pressure Service UUID");
            var characteristicUUIDs = ['2a35', '2a49'];
            //2a35: Blood pressure BPM Indication  
            //2a49: Blood pressure feature 
            service.discoverCharacteristics(characteristicUUIDs, function(error, characteristics) {
                debuglog("Got characteristics " + characteristics); //this is an indication notification will not work
                //requestNotify(characteristics[0]); //requestNotification for the BPM indication ==> should work smoothly
                //performPeriodicRead(characteristics[0]);
                oicBpmInitService(characteristics[0]);
            });
        }

        if (service.uuid === '180f') { // remove XXX to work with battery service
            debuglog("Found Battery Service UUID");
            var characteristicUUIDs = ['2a19'];
            //2a19: Battery Level notification/read  
            service.discoverCharacteristics(characteristicUUIDs, function(error, characteristics) {
                debuglog("Got characteristics " + characteristics);
                oicBasInitService(characteristics[0]);

            });
        }
    });

};


/*-------- Service/Resource specific functions --------------*/

/*-------- HRM specific functions --------------*/
var oicHrmInitService = function(characteristic) {
    //local vars
    var
        resourceInterfaceName = '/a/hrm/' + characteristic._peripheralId + '/' + characteristic._serviceUuid,
        resourceTypeName = 'oic.r.BLE_HRM',
        deviceID;

    characteristic.on('read', function(data, isNotification) {

        var temp_measu = data.readUInt8(1);

        for (var i in oicResources) {
            if (oicResources[i].serviceUuid === this._serviceUuid && oicResources[i].peripheralID === this._peripheralId) {
                //debuglog("Updating resource id " + i + " with hr read: " + temp_measu);
                if (oicResources[i].oicSensorData.hr_measu != temp_measu) {
                    oicResources[i].hasUpdate = true;
                    oicResources[i].oicSensorData.hr_measu = temp_measu;
                }
            }
        }
    });


    characteristic.notify(true, function(error) {
        debuglog('Turned on notifications for ' + characteristic + (error ? '  with error' : '  without error'));
    });

    if (ocfDevice.device.uuid) { //device uuid exists as part of device interface
        // Register HRM resource
        debuglog("=========> Register HRM service as OCF Resource");
        ocfDevice.server.register({
            resourcePath: resourceInterfaceName,
            resourceTypes: [resourceTypeName],
            interfaces: ['oic.if.baseline'],
            discoverable: true,
            observable: true,
            secure: true,
            properties: getHrsProperties(null, resourceTypeName) //this resource needs to be involved!
        }).then(
            function(resource) {
                /* 	This is where iotivity server is created and adds handlers for different operation.
			   		Add retrieve handler and register with RD
        		*/

                //fill the oicResources array 
                var rsrcIndex = getResourceID(resource);

                oicResources[rsrcIndex] = {
                    rsrc: resource,
                    serviceUuid: characteristic._serviceUuid,
                    peripheralID: characteristic._peripheralId,
                    oicSensorData: {
                        hr_measu: 2223,
                        hr_sensor: 0,
                        hr_control: 0
                    },
                    hasUpdate: false,
                    observeHandler: new ObserverWrapper(resource, 2, getHrsProperties),
                    observerCount: 0,
                };

                oicResourceCount++;
                debuglog("oicHrmInitService: oicResource info updated. Resource created:" + resourceInterfaceName);
                resource.onretrieve(bleRetrieveHandler);

                //RD registration for all proxied resources
                if (rdRegisterMode === true) {
                    setTimeout(RegisterWithRD(resource._private.handle), 0);
                }


            },

            function(error) {
                debuglog('register() resource failed with: ', error);
            });
    }


}

function getHrsProperties(resID, rtName) {
    //debuglog("ResId = " + resID);
    var properties;
    if (resID === null) {
        properties = {
            rt: rtName,
            id: 'BLE_HR_Service',
            hr_measu: 0,
            hr_sensor: 0,
            hr_control: 0
        };
    } else {
        properties = {
            rt: rtName,
            id: 'BLE_HR_Service',
            hr_measu: oicResources[resID].oicSensorData.hr_measu,
            hr_sensor: oicResources[resID].oicSensorData.hr_sensor,
            hr_control: oicResources[resID].oicSensorData.hr_control,
        };
    }
    //debuglog('Zephyr_HR: get properties done ' + JSON.stringify( properties, null, 4 ));
    return properties;
}
/*-------- End HRM specific functions --------------*/


/*-------- BPM specific functions --------------*/
var oicBpmInitService = function(characteristic) {
    var
        resourceInterfaceName = '/a/bpm/' + characteristic._peripheralId + '/' + characteristic._serviceUuid,
        resourceTypeName = 'oic.r.BLE_BPM',
        perioidicReader,
        deviceID;

    characteristic.on('read', function(data, isNotification) { //Todo: BPM parsing and indication processing not working
        var temp_measu = "Garbage" + getRandomArbitrary(1, 100); //data.readUInt8(1)<<8 | data.readUint8(2); 		
        for (var i in oicResources) {
            if (oicResources[i].serviceUuid === this._serviceUuid && oicResources[i].peripheralID === this._peripheralId) {
                //debuglog("Updating resource id " + i + " with BPM read: " + temp_measu);
                if (oicResources[i].oicSensorData.systolic_measu != temp_measu) {
                    oicResources[i].hasUpdate = true;
                    oicResources[i].oicSensorData.systolic_measu = temp_measu;
                }
            }
        }
    });

    perioidicReader = new performPeriodicRead(characteristic);
    debuglog("Created periodic reader: " + JSON.stringify(perioidicReader));

    if (ocfDevice.device.uuid) { //device uuid exists as part of device interface
        // Register BPM resource
        debuglog("=========> Register BPM service as OCF Resource");
        ocfDevice.server.register({
            resourcePath: resourceInterfaceName,
            resourceTypes: [resourceTypeName],
            interfaces: ['oic.if.baseline'],
            discoverable: true,
            observable: true,
            secure: true,
            properties: getBpmProperties(null, resourceTypeName) //this resource needs to be involved!
        }).then(
            function(resource) {
                /* 	This is where iotivity server is created and adds handlers for different operation.
			   		Add retrieve handler and register with RD
        		*/

                //fill the oicResources array 
                var rsrcIndex = getResourceID(resource);

                oicResources[rsrcIndex] = {
                    rsrc: resource,
                    serviceUuid: characteristic._serviceUuid,
                    peripheralID: characteristic._peripheralId,
                    oicSensorData: {
                        systolic_measu: 2223,
                        diastolic_measu: "PH_4567",
                        arterial_measu: "PH_6789"
                    }, //Todo: update properly for BPM
                    hasUpdate: false,
                    //retrieveHandler: {}, //probably also need a retrieve handler object per resource
                    observeHandler: new ObserverWrapper(resource, 2, getBpmProperties),
                    observerCount: 0,
                };

                //debuglog("oicBpmInitService: oicResource info updated" + JSON.stringify(oicResources[rsrcIndex], null, 4 ));
                debuglog("oicBpmInitService: oicResource info updated. Resource created:" + resourceInterfaceName);

                oicResourceCount++;

                resource.onretrieve(bleRetrieveHandler);

                //RD registration for all proxied resources
                if (rdRegisterMode === true)
                    setTimeout(RegisterWithRD(resource._private.handle), 0);

            },

            function(error) {
                debuglog('register() resource failed with: ', error);
            });
    }


}

function getBpmProperties(resID, rtName) {
    //debuglog("ResId = " + resID);
    var properties;
    if (resID === null) {
        properties = {
            rt: rtName,
            id: 'BLE_BP_Service',
            systolic_measu: 0,
            diastolic_measu: 0,
            arterial_measu: 0
        };
    } else {
        properties = {
            rt: rtName,
            id: 'BLE_BP_Service',
            systolic_measu: oicResources[resID].oicSensorData.systolic_measu,
            diastolic_measu: oicResources[resID].oicSensorData.diastolic_measu,
            arterial_measu: oicResources[resID].oicSensorData.arterial_measu,
        };
    }
    //debuglog('Zephyr_HR: get properties done ' + JSON.stringify( properties, null, 4 ));
    return properties;
}
/*-------- End BPM specific functions --------------*/

/*-------- BAS specific functions --------------*/
var oicBasInitService = function(characteristic) {
    var
        resourceInterfaceName = '/a/bas/' + characteristic._peripheralId + '/' + characteristic._serviceUuid,
        resourceTypeName = 'oic.r.BLE_BAS',
        perioidicReader,
        deviceID;

    characteristic.on('read', function(data, isNotification) {
        if (data.length > 0) {

            var temp_measu = data.readUInt8(0);

            for (var i in oicResources) {
                if (oicResources[i].serviceUuid === this._serviceUuid && oicResources[i].peripheralID === this._peripheralId) {
                    //debuglog("Updating resource id " + i + " with BAS read: " + temp_measu);
                    if (oicResources[i].oicSensorData.battery_level != temp_measu) {
                        oicResources[i].hasUpdate = true;
                        oicResources[i].oicSensorData.battery_level = temp_measu;
                    }
                }
            }
        }
    });


    characteristic.notify(true, function(error) {
        debuglog('Turned on notifications for ' + characteristic + (error ? '  with error' : '  without error'));
    });

    if (ocfDevice.device.uuid) {
        // Register BAS resource
        debuglog("=========> Register BAS service as OCF Resource");
        ocfDevice.server.register({
            resourcePath: resourceInterfaceName,
            resourceTypes: [resourceTypeName],
            interfaces: ['oic.if.baseline'],
            discoverable: true,
            observable: true,
            secure: true,
            properties: getBasProperties(null, resourceTypeName) //this resource needs to be involved!
        }).then(
            function(resource) {
                /* 	This is where iotivity server is created and adds handlers for different operation.
			   		Add retrieve handler and register with RD
        		*/

                //fill the oicResources array 
                var rsrcIndex = getResourceID(resource);

                oicResources[rsrcIndex] = {
                    rsrc: resource,
                    serviceUuid: characteristic._serviceUuid,
                    peripheralID: characteristic._peripheralId,
                    oicSensorData: {
                        battery_level: "NaN"
                    },
                    hasUpdate: false,
                    //retrieveHandler: {}, //probably also need a retrieve handler object per resource
                    observeHandler: new ObserverWrapper(resource, 2, getBasProperties),
                    observerCount: 0,
                };
                debuglog("oicBasInitService: oicResource info updated. Resource created:" + resourceInterfaceName);
                //debuglog("oicBasInitService: oicResource info updated" + JSON.stringify(oicResources[rsrcIndex], null, 4 ));

                oicResourceCount++;

                resource.onretrieve(bleRetrieveHandler);

                //RD registration for all proxied resources
                if (rdRegisterMode === true) {
                    //RegisterWithRD(resourceHandleReceptacle.handle);
                    setTimeout(RegisterWithRD(resource._private.handle), 0);
                }

            },

            function(error) {
                debuglog('register() resource failed with: ', error);
            });
    }


}

function getBasProperties(resID, rtName) {
    //debuglog("ResId = " + resID);
    var properties;
    if (resID === null) {
        properties = {
            rt: rtName,
            id: 'BLE_BATTERY_Service',
            battery_level: 0,
        };
    } else {
        properties = {
            rt: rtName,
            id: 'BLE_BATTERY_Service',
            battery_level: oicResources[resID].oicSensorData.battery_level,
        };
    }
    //debuglog('get properties done ' + JSON.stringify( properties, null, 4 ));
    return properties;
}
/*-------- End BAS specific functions --------------*/

/*--------- Common Functions for all services/resources ---------*/
function getResourceID(resource) {
    var temp = resource.resourcePath.replace(/\//g, "");;
    return temp;
}


function bleRetrieveHandler(request) {

    var BLE_Resource = request.target;
    var rsrcIndex;

    rsrcIndex = getResourceID(BLE_Resource);
    //debuglog('Processing retrieve request. Properties: ' + JSON.stringify( BLE_HRS_Resource.properties ));
    request.respond(BLE_Resource).catch(handleError);

    if ("observe" in request) {
        oicResources[rsrcIndex].observerCount += request.observe ? 1 : -1;
        if (request.observe)
            oicResources[rsrcIndex].observeHandler.addObserver();
        else
            oicResources[rsrcIndex].observeHandler.removeObserver();
    }

}


function handleError(error) {
    debuglog('Failed to send response with error: ', error);
}
/*--------- End Common Functions for all resources ---------*/


//Use this as base to handle service that does not support Notification/indication
function performPeriodicRead(characteristic) {

    var local_chrctrstc = characteristic;
    debuglog('Going to turn on periodic read for ' + characteristic);

    var intervalID = setInterval(function() {
            //debuglog('periodic reading for:' + local_chrctrstc);		
            local_chrctrstc.read();
        },
        2000); //link it to device to we can remove later


}

function getRandomArbitrary(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}


//The declaration of the cleanup function set to be the handler for process.on("message", cleanup);
//clears interval of running process loop and exits
function oic_cleanup() {
    if (processLoop) {
        clearInterval(processLoop);
        processLoop = null;
    }
    console.log("BLE_OCF_Bridge: OCProcess succeeded " + processCallCount + " times");

    var res_ok = iotivity.OCStackResult.OC_STACK_OK;
    var res = iotivity.OCStop();
    if (res != res_ok)
        console.log("Failed to stop iotivity");
}

//=================================================================================
// RD functions
//=================================================================================
function DiscoverRD() {
    debuglog("=======> Discovering RD");
    var discoverRes;
    result = iotivity.OCRDDiscover({},
        iotivity.OCConnectivityType.CT_DEFAULT,
        function OCRDDiscoverResponse(handle, response) { //this is the OCRDDiscoverResponse handler	
            discoverRes = response.result;
            //debuglog('OCRDDiscover Response from RD' + JSON.stringify( { response: response } ) ); 
            //debuglog("BLE_Bridge: OCRDDiscover returned result ", discoverRes);           
            rdServerAddress = response.addr.addr + ":" + response.addr.port;
            debuglog('RD Server Address: ' + rdServerAddress);
            if (discoverRes != iotivity.OCStackResult.OC_STACK_OK) {
                debuglog("Severe Error::::: BLE_Bridge: OCRDDiscover failed with result ", discoverRes);
            }
            proceedWithRD = true;
            return iotivity.OCStackApplicationResult.OC_STACK_DELETE_TRANSACTION;
        },
        iotivity.OCQualityOfService.OC_HIGH_QOS
    );

    if (result != iotivity.OCStackResult.OC_STACK_OK) {
        debuglog("BLE_Bridge: OCRDDiscover failed with ", result);
        //process.exit(result);
    }
    return result;
}

function RegisterWithRD(localResouceHandleReceptacle) {
    var _flagCheck = setInterval(function() {
        if (proceedWithRD == true) {
            clearInterval(_flagCheck);
            PublishToRD(localResouceHandleReceptacle);
        } else {
            debuglog(' Waiting to publish');
        }
    }, 400);


}

function PublishToRD(resHandle) {
    //debuglog('In publish RD Server Address: ' + rdServerAddress);
    result = iotivity.OCRDPublish({},
        rdServerAddress,
        iotivity.OCConnectivityType.CT_DEFAULT,
        [resHandle],
        86400,
        function OCRDPublishResponse(handle, response) {
            var index;
            debuglog('In OCRDPublishResponse');
            var links = response && response.payload && response.payload.values && response.payload.values.links;
            if (links) {
                //debuglog('RDPublishResponse from:' + response.addr.addr + ":" + response.addr.port + JSON.stringify( links, null, 4 ));

                for (index in links) {
                    //debuglog( links[ index ].href);
                    if (links[index].href === [resHandle].uri) {
                        break;
                    }
                }

                if (index < links.length)
                    debuglog("BLE Bridge: Posted resource found in OCRDPublish response");
            } else {
                debuglog('Received Invalid Response from RD' + JSON.stringify({
                    response: response
                }));
            }

            return iotivity.OCStackApplicationResult.OC_STACK_DELETE_TRANSACTION;
        },
        iotivity.OCQualityOfService.OC_HIGH_QOS);


    debuglog("BLE_Bridge : OCRDPublish returned with", result);
}

function DeleteFromRD(resHandle) {

    result = iotivity.OCRDDelete({},
        rdServerAddress,
        iotivity.OCConnectivityType.CT_DEFAULT,
        [resHandle],
        function OCRDDeleteResponse(handle, response) {
            return iotivity.OCStackApplicationResult.OC_STACK_DELETE_TRANSACTION;
        },
        iotivity.OCQualityOfService.OC_HIGH_QOS);

    debuglog("BLE_Bridge : OCRDPDelete returned with", result);
}

function RD_DeRegisterAllResources() {
    var temp_res;

    for (var i in oicResources) {
        temp_res = oicResources[i].rsrc; //Todo: keep resource in globla array to be able to clean it up
        DeleteFromRD(temp_res._private.handle);
    }
}

//=================================================================================
//Noble State machine definition
//false = do not allow multiple - devices differentiated by peripheral UUID
//limit to devices having the service UUID defined above
//=================================================================================
noble.on('stateChange', function(state) {
    console.log('on -> stateChange');
    console.log('state is ' + state);
    if (state === 'poweredOn') {
        // only search for devices with defined servicews UUID
        noble.startScanning(serviceUuids, false);
    } else {
        console.log('stop scanning state is ' + state);
        noble.stopScanning();
    }
});

noble.on('discover', discover);

var exitHandler = function exitHandler() {
    peripherals.forEach(function(peripheral) {
        console.log('Disconnecting from ' + peripheral.uuid + '...');
        peripheral.disconnect(function() {
            console.log('disconnected');
        });
    });

    //TODO: add cleanup for each resource, probably de-register from RD etc
    if (rdRegisterMode)
        RD_DeRegisterAllResources();

    processLoopProceed = false;
    oic_cleanup();

    //End process after 3 more seconds so all background tasks finish peacefully
    setTimeout(function() {
        process.exit();
    }, 3000);
}

process.stdin.resume(); //so the program will not close instantly
