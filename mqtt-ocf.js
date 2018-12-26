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
var debuglog = myutil.debuglog('ocf_mqtt');

/* 
 The Central Structure: oicResources created OCF resource to handle he services.	
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
                //debuglog("in add observer rsrcIndex = " + rsrcIndex + "   properties = " + JSON.stringify(resource.properties, null, 4 )) ;
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
        //debuglog("Observers for " + JSON.stringify(this.resource, null, 4)  + " = " + this.observerCount);
        if (this.observerCount <= 0) {
            debuglog("Turning off interval for " + JSON.stringify(this.resource.resourcePath, null, 4));
            clearInterval(this.intervalId);
            this.observerCount = 0;
            this.intervalId = 0;
        }
    }
}
/*---------------------End of class ---------------------------------*/

const EventEmitter = require('events');
var mosca = require('mosca');
var mylock = true;

var ocfDevice = require('iotivity-node');
ocfDevice.device = Object.assign(ocfDevice.device, {
    name: 'OCF MQTT Proxy Server',
    coreSpecVersion: 'core.1.1.0',
    dataModels: ['res.1.1.0']
});

ocfDevice.platform = Object.assign(ocfDevice.platform, {
    manufacturerName: 'Campie_CU',
    manufactureDate: new Date('Mon Sep 10 12:00:00 (GMT) 2018'),
    platformVersion: '1.1.0',
    firmwareVersion: '0.0.1'
});


var server = new mosca.Server({
    host: '127.0.0.1',
    port: 3333
});

server.on('clientConnected', function(client) {
    console.log('client connected', client.id);
});

server.on('clientDisconnected', function(client) {
    console.log('client disconnected', client.id);
});

server.on('published', function(packet, client) {
    //console.log('published from: ', client.id);
    //console.log("Published: ");
    //console.log(packet);

    if (mylock === true) {
        mylock = false;
        var tempTopic = packet.topic;
        if (client && client.id) {
            //console.log('Published: '+ tempTopic + ' from: '+ client.id);
            ocfMqttPublishHandle(tempTopic, client.id, packet.payload);
        }

        mylock = true;
    }
});

server.on('subscribed', function(topic, client) {
    console.log('subscribed: ' + client.id + ' to topic: ' + topic);
    ocfMqttSubscribeHandle(topic, client);
});

server.on('unsubscribed', function(topic, client) {
    console.log('unsubscribed: ' + client.id);
});

server.on('ready', function() {
    console.log('Mosca server is up and running');
});

/* Create mqtt virtual client to send publish request when OCF proxy receives PUT requests*/

var mqtt = require('mqtt');
var virtual_client = mqtt.connect('mqtt://127.0.0.1:3333');
//console.log('virtual client connected', virtual_client.id)

virtual_client.on('message', function(topic, message) {
    console.log("Received: " + message.toString() + " on topic: " + topic.toString());
});

var ocfMqttPublishHandle = function(topic, client_id, payload) {
    //local vars
    var
        createResource = true,
        resourceInterfaceName = '/a/mqtt/' + topic,
        resourceTypeName = 'oic.r.MQTT_PUB',
        deviceID;
    //console.log("oicHrmInitService: The resource interface is" + resourceInterfaceName);			
    for (var i in oicResources) {
        if (oicResources[i].mqtt_topic === topic) {
            createResource = false;
            //debuglog("--Updating resource id " + i + " with data: " + payload);
            if (oicResources[i].data != payload) {
                oicResources[i].hasUpdate = true;
                oicResources[i].data = payload;
            }
        }
    }

    if (createResource) {
        if (ocfDevice.device.uuid) { //device uuid exists as part of device interface
            // Register HRS resource
            debuglog("=========> OCF register service: " + resourceInterfaceName);
            ocfDevice.server.register({
                resourcePath: resourceInterfaceName,
                resourceTypes: [resourceTypeName],
                interfaces: ['oic.if.baseline'],
                discoverable: true,
                observable: true,
                secure: true,
                properties: getMqttData(null, resourceTypeName) //this resource needs to be involved!
            }).then(
                function(resource) {
                    /* 	This is where iotivity server is created and adds handlers for different operation.
			   		Add retrieve handler and register with RD
        		*/

                    //fill the oicResources array 
                    var rsrcIndex = getResourceID(resource);
                    //debuglog("++Updating resource id " + rsrcIndex + " with data: " + payload);
                    oicResources[rsrcIndex] = {
                        mqtt_topic: topic,
                        client: client_id,
                        data: payload,
                        hasUpdate: true,
                        observeHandler: new ObserverWrapper(resource, 2, getMqttData),
                        observerCount: 0,
                    };

                    oicResourceCount++;
                    debuglog(" oicMqttService: oicResource info updated. Resource created:" + resourceInterfaceName);
                    resource.onupdate(mqttUpdateHandler);
                    resource.onretrieve(mqttRetrieveHandler);

                    //RD registration for all proxied resources
                    //RegisterWithRD(resource._private.handle); 

                },

                function(error) {
                    debuglog('register() resource failed with: ', error);
                });
        }
    }

}

var ocfMqttSubscribeHandle = function(topic, client_id) {
    //local vars
    var
        createResource = true,
        resourceInterfaceName = '/a/mqtt/' + topic,
        resourceTypeName = 'oic.r.MQTT_SUB',
        deviceID;
    //console.log("oicHrmInitService: The resource interface is" + resourceInterfaceName);			
    for (var i in oicResources) {
        if (oicResources[i].mqtt_topic === topic) {
            createResource = false;
        }
    }

    if (createResource) {
        if (ocfDevice.device.uuid) { //device uuid exists as part of device interface
            // Register HRS resource
            debuglog("=========>  OCF register service: " + resourceInterfaceName);
            ocfDevice.server.register({
                resourcePath: resourceInterfaceName,
                resourceTypes: [resourceTypeName],
                interfaces: ['oic.if.baseline'],
                discoverable: true,
                observable: true,
                secure: true,
                properties: getMqttData(null, resourceTypeName) //this resource needs to be involved!
            }).then(
                function(resource) {
                    /* 	This is where iotivity server is created and adds handlers for different operation.
			   		Add retrieve handler and register with RD
        		*/

                    //fill the oicResources array 
                    var rsrcIndex = getResourceID(resource);
                    //debuglog("++Updating resource id " + rsrcIndex + " with data: " + payload);
                    oicResources[rsrcIndex] = {
                        mqtt_topic: topic,
                        client: client_id, //multiple clients may subscribe, so this may not be correct
                        data: "",
                        hasUpdate: true,
                        observeHandler: new ObserverWrapper(resource, 2, getMqttData),
                        observerCount: 0,
                    };

                    oicResourceCount++;
                    debuglog(" oicMqttService: oicResource info updated. Resource created:" + resourceInterfaceName);
                    resource.onupdate(mqttUpdateHandler);
                    resource.onretrieve(mqttRetrieveHandler);

                    //TODO: add ondelete  handlers

                    //RD registration for all proxied resources
                    //RegisterWithRD(resource._private.handle); 

                },

                function(error) {
                    debuglog('register() resource failed with: ', error);
                });
        }
    }

}

function getMqttData(resID, rtName) {
    //debuglog("ResId = " + resID);
    var properties;
    if (resID === null) {
        properties = {
            rt: rtName,
            id: 'Mqtt_Service',
            payload: 'MQTT_NO_DATA'
        };
    } else {
        //debuglog("payload: " + oicResources[resID].data);
        properties = {
            rt: rtName,
            id: 'Mqtt_Service',
            payload: String(oicResources[resID].data)
        };
    }
    //debuglog('Zephyr_HR: get properties done ' + JSON.stringify( properties, null, 4 ));
    return properties;
}


/*--------- Common Functions for all services/resources ---------*/
function getResourceID(resource) {
    //debuglog('resource is ' + JSON.stringify(resource));
    //var temp=resource.properties.peripheralID+"_"+resource.properties.serviceUuid;
    var temp = resource.resourcePath.replace(/\//g, "");;
    return temp;
}


function mqttRetrieveHandler(request) {

    var mqtt_Resource = request.target;
    var rsrcIndex;

    rsrcIndex = getResourceID(mqtt_Resource);
    mqtt_Resource.properties = getMqttData(rsrcIndex, mqtt_Resource.resourceTypes[0]);
    debuglog('Processing retrieve request. Properties: ' + JSON.stringify(mqtt_Resource.properties));
    request.respond(mqtt_Resource).catch(handleError);

    if ("observe" in request) {
        oicResources[rsrcIndex].observerCount += request.observe ? 1 : -1;
        if (request.observe) {
            debuglog("========> Adding observer to resource " + rsrcIndex);
            oicResources[rsrcIndex].observeHandler.addObserver();
        } else
            oicResources[rsrcIndex].observeHandler.removeObserver();
    }

}


function mqttUpdateHandler(request) {
    /*
    Get the topic asccociated with the resouce
    send a publish request to server with the data in the request
    */
    var mqtt_Resource = request.target;
    var mqtt_topic;
    var rsrcIndex;

    //debuglog('Processing PUT request: ' + JSON.stringify( request ));

    rsrcIndex = getResourceID(mqtt_Resource);

    mqtt_topic = oicResources[rsrcIndex].mqtt_topic;

    oicResources[rsrcIndex].data = String(request.data.value);
    //oicResources[rsrcIndex].data=JSON.stringify(request.data);
    oicResources[rsrcIndex].hasUpdate = true;

    mqtt_Resource.properties = getMqttData(rsrcIndex, mqtt_Resource.resourceTypes[0]);
    //virtual_client.publish(mqtt_topic, request.data.payload);
    virtual_client.publish(mqtt_topic, oicResources[rsrcIndex].data);

    debuglog('Processing PUT request: rsrcIndex   ' + rsrcIndex);
    debuglog('Processing PUT request. Resource Properties: ' + JSON.stringify(mqtt_Resource.properties));
    request.respond(mqtt_Resource).catch(handleError);
}

function handleError(error) {
    debuglog('Failed to send response with error: ', error);
}
/*--------- End Common Functions for all resources ---------*/


process.stdin.resume();