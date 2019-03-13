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

var mqtt = require('mqtt');
var options = {
    port: 3333,
    host: '127.0.0.1',
    protocol: 'mqtt',
    queueQoSZero: false
}

var client = mqtt.connect(options);
console.log("Going to publish LEDToggle");

client.on('message', function(topic, message) {
    console.log("Received: " + message.toString() + " on topic: " + topic.toString());
});

var ledCommand = '001';

setInterval(function() {
    ledCommand = (ledCommand === '001') ? '002' : '001';
    client.publish('LEDToggle', ledCommand);
}, 2000);


process.stdin.resume();