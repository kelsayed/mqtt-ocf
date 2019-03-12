# ble-ocf-bridge

## Description

This project provides a node.js based bridge for interconnecting devices with Bluetooth low energy (BLE) profiles to OCF based clients.  It is based on [iotivity-node](https://github.com/intel/iotivity-node) Iotivity implementation in node.js and [noble](https://github.com/noble/noble) BLE central library. 

In summary, an OCF resource is created for each identified discovered BLE peripheral device hosting one or more supported GATT service/profile. The OCF resource is then optionally registered with the OCF resource directory (RD).

The implementation has the following features:
1. Supports multiple BLE devices.
2.	Supports multiple GATT profiles per BLE device
3.	Support different types of BLE GATT profiles. The bridge currently supports the BLE heart rate service and battery service profiles.
4.	Support notifications and read operations of the BLE characteristics of the corresponding profiles. Write operation is straight-forward extension left for future work.
5.	Generate a unique OCF resource for each BLE device and discovered profile on the device with proper resource type.
6.	Optionally register the created resources with the OCF RD.

## Installation

This package has been tested on Linux only. Should run similarly on  OSX. Since iotivity-node downloads  [IoTivity](http://iotivity.org) and builds parts of it, be warned that installation on a computer that has not installed IoTivity before, may involve doing a lot of steps to install libraries and dependencies that IoTivity needs. See the following subsection for some commands that can be handy for a Ubunto based Linux distribution to expedite the installation process. 

For installation do the following:

1. Make sure [node](https://nodejs.org) version 4.2.6 or later is up and running (It should actually work on older versions, but this is the version that I tested it with). This means that:
  1. the command `node -v` reports a version  4.2.6 or higher
  1. the directory in which the `node` binary can be found is listed in the `PATH` environment variable.
1. Install the following packages, which your distribution should provide:
   1. unzip, scons (version 2.51), git, make, autoconf
   1. Development headers for libuuid, and glib2
   1. A C compiler and a C++ compiler (gcc-4.7 or later)
1. Clone this repository.
1. cd `ble-ocf-bridge`
1. Run `npm install`. This should download the iotivity-node and noble packages and their dependencies. Downloading iotivity-node installs IoTivity library. More details can be found in the [iotivity-node](https://github.com/intel/iotivity-node) package repository.

### Some Useful Installation Commands on Ubunto-based Linux Systems
On systems like Ubunto and Mint, the following commands can be handy to install some of the tools/libraries needed by IoTivity. Still not every things but it should be helpful.
1. scons: `sudo apt-get install scons`
1. glib2: `sudo apt-get install libglib2.0-dev`
1. libuuid: `sudo apt-get install uuid-dev`
1. sqlite3: `sudo apt-get install sqlite3 libsqlite3-dev`
1. autoconf, autotools-dev, automake: </br>
     `sudo apt-get install autoconf`</br>
     `sudo apt-get install autotools-dev`</br>
     `sudo apt-get install automake`

Note that I have experienced that new versions of Ubunto/Mint can result in IoTivity 1.3.x (which IoTivity-node uses) compilation errors. Current work to upgrade Iotivity-Node to work with IoTivity 2.0.0 should resolve these issues. The system was tested on Linux Mint 18.1.


## Detailed Description and Flows
The package consists of one module the ble-ocf-bridge.js which is called the "bridge". There are additional shell scripts used to facilitate the execution of the bridge and/or its testing. There are three additional folders:

- js: this contains helper node.js scripts comprising OCF observer and get clients. It also contains a node.js based RD server.
- acl: this contains the security/credentials/ACL json files and utility to install the security configuration files.
- images: some PNG images used for this Readme file. 

The node.js implementation is fully based on Javascript asynchronous events handling concept to be able to handle the multiple events resulting from the connected BLE devices notifications, OCF client-side network events, and timer-triggered events in the node.js code. The node.js main asynchronous flow is described below. Note that once initialization steps 1 and 2 are  done, the rest of the steps are asynchronous events (some of these events are dependent on each other).

1.	Initialize IoTivity stack loading the required security credentials. 
2.	Load BLE Noble and start scanning for BLE devices. All subsequent steps are event-based triggered by an external event.
3. When a BLE device is found, connect to it and discover the supported profiles.
4.	If supported profile found, then discover its characteristics. 
	1.	If characteristic found, then proceed to create OCF resource unique for the BLE device and characteristic. For example, If the peripheral id is cec2aa5def41 and the service UUID is 180d (heart rate service) then the URI of the OCF resource is /a/hrm/cec2aa5def41/180d. This is guaranteed to be unique as peripheral IDs are unique among devices and service IDs are unique within a device. 
	2.	Link the BLE characteristic with the OCF resources. This is done via the array `oicResources`. This is an associative Javascript array indexed by the unique resource URI and holds the BLE service and peripheral UUID as well as the data coming from the BLE characteristic associated with the resource.
	3.	Optionally publish the created OCF resource to the RD.
	4.	If BLE characteristic supports notification, register the BLE peripheral at the ble-ocf-bridge  as a receiver for notification. 
	5.	If BLE characteristic does not support notification, then construct a periodic reader that reads the characteristic periodically.
5.	When BLE notification is received or the periodic reader reads the characteristic value, update the resource data and push the update to OCF subscribers (if any).
6.	When receiving OCF operation (e.g. GET) on the resource, handle it as a normal OCF operation using freshest data from the `oicResources` array.
7.	If an OCF operation contain an observe request, add the OCF client requesting the observ to the observers list of the resource. 
8.	If connected BLE device is disconnected, delete the associated resources. </br> 
**TODO**: This should also remove the resources from the RD database.




### Examples

The node.js JavaScript examples are located in [js/](./js/) . 

#### Setting the OCF  Security Credentials

In order to be able to run the ble-ocf bridge, all OCF transactions must be secured. Currently, the ble-ocf-bridge uses the simplest type of security authentication which is the usage of pre-shared keys (PSKs). The package provides example json files that contain proper credentials for the ble-ocf-bridge script and the multiple clients that are used to demonstrate the package. Currently there are three json files:

1. working-server.json: This has ACL entries for the resources created for the  ble-ocf bridge and has wild card entries for those unknown resources that will be created as BLE devices are discovered. It contains credentials needed to access the RD-server. It also contains credentials for two (test/demo) clients with PSK credentials. 
2. rd-server.json: This has ACL entries for the resource directory and clients' credentials (e.g. as in  working-server.json) allowed to access the RD.
3. working-client.json: An OCF client credential file with proper PSK to be able to access the ble-ocf bridge. 
4. working-client2.json: Identical to working-client.json but with a different Device UUID.

When operated with these JSON files, all OCF devices are considered already provisioned and owned. This is not a limitation as any other OCF provisioning model can be supported by simply changing the security/provisioning json files. Interested readers should consult Iotivity wiki guide on [provisioning](https://wiki.iotivity.org/provisioning) and the [presentation](https://openconnectivity.org/wp-content/uploads/2018/06/4.-Security-Introduction-Architecture.pdf) by Nathan Heldt-Sheller on OCF security. 

To run the examples, the first thing we need to do is setup the security and provisioning credentials. Iotivity-node stores security-related information for a given script in a pre-defined directory. It does so by creating a directory `${HOME}/.iotivity-node`. Thereunder, it creates directories whose name is the sha256 checksum of the absolute path of the given node.js script and the security credential file is named `oic_svr_db.dat`. To facilitate this job, we provide a shell script that can be used to automate this job in the acl folder called`setup_sec_json.bash`. 

Below we show how to setup the security credentials for ble-ocf-bridge. First, make sure that  `setup_sec_json.bash`has execute permission. If not do a `chmod 755 setup_sec_json.bash`.

1. In the package root directory where ble-ocf-bridge.js is found, issue the following command:

    `acl/setup_sec_json.bash  ble-ocf-bridge.js  acl/working-server.json`</br>
    `acl/setup_sec_json.bash  rd-server.js  acl/rd-server.json`</br>

2. cd js and issue the following commands and repeat for the remaining clients that you want to test with. We mainly demonstrate with `client-arg.observe.js`  and `client.get.coaps.js`</br>
 (**Update get client info**).

   a-  `../acl/setup_sec_json.bash  client-arg.observe.js  ../acl/working-client.json`

   b-  `../acl/setup_sec_json.bash  client.get.coaps.js  ../acl/working-client2.json`

You will now be ready to move to the next step. 

#### Execution 

First make sure no firewall is running (or one is properly configured to allow iotivity-related traffic and especially multicast traffic) on the machine(s) where these applications are running.

The demonstration requires nodes supporting BLE with HRS and BAS profiles. I have used Nodic NRF modules programmed with Nordik SDK. One node supports HRS and BAS profile and the second supports blood pressure monitor (BPM) and BAS. The machine used to run the ble_ocf_bridge had an Intel module with BLE v4.2 running Bluez 5.3  stack.

1. Go to the root directory of `ble-ocf-bridge.js`, open a shell terminal, and execute </br> 
   `node  js/rd-server.js`</br>
    in case registration with RD is required
  2. Run the BLE-OCF-Bridge by issuing
  `sudo node ble-ocf-bridge.js 1` </br>
  use 1 to register created resources with RD server, 0 for not using RD </br>
  3. OR if interested in watching closely what is going on then use the following shell script</br>
  `demo_ble_bridge.sh` </br>
  Edit the script to turn on/off registering with RD server.

4. Now turn on the NRF modules or other BLE modules one at a time. The bridge should immediately discover both devices and create multiple resources. My two devices had a UUID of cec2aa5def41 and ef4eb89335f7 respectively. If the bridge does not discover all devices, better turn on one device at a time. This really depends on how good your BLE subsystem is. The resources created for my two devices were:
	  1.  /a/hrm/cec2aa5def41/180d: 180d is UUID of heart rate service
	  2.  /a/bas/cec2aa5def41/180f: 180f is UUID of battery service
	  3. /a/hrm/ef4eb89335f7/180d: 180d is UUID of heart rate service

5. Now, it is time to start some OCF clients. Issue an observer client  by issuing </br> 
   `node  js/client-arg.observe.js /a/hrm/cec2aa5def41/180d 100` </br>
   what this does is observing the `/a/hrm/cec2aa5def41/180d` resource for 100 times. You can run this again with different resources (e.g. the /a/bas/cec2aa5def41/180f ). The OCF client should then get the same updates as any BLE central device connected to the peripheral. 


That's it, Voila :-) **We now have a fully versatile system that interconnects BLE and OCF Worlds!**

A handy tool that helped me in the development was the [OCFSecure/client](https://github.com/iotivity/iotivity/blob/master/examples/OCFSecure/client.c) program of the IoTivity package. 

## Acknowledgements

This work is part of the [Campie Project](http://campie.cu.edu.eg) funded by the [National Telecom Regulatory Authority NTRA](http://ntra.gov.eg) of [Egypt](http://www.egypt.travel/).

Would like to ACK the tiresome efforts of [Gabriel Schulhof](https://github.com/gabrielschulhof) who really helped me a lot understand node.js and iotivity-node. 

Would also like to ACK Nathan Heldt-Sheller for good insights on OCF security. 




