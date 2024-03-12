import { Red, Node } from 'node-red';
import { DockerConfiguration } from './docker-configuration';
import * as Dockerode from 'dockerode';


module.exports = function (RED: Red) {

    function DockerVolumeAction(n: any) {
        RED.nodes.createNode(this, n);
        let config = RED.nodes.getNode(n.config) as unknown as DockerConfiguration;
        let client = config.getClient();
        this.on('input', (msg, send, done) => {

            let volumeId: string = RED.util.evaluateNodeProperty(n.volume, n.volumetype, n, msg) || msg.payload.volumeId || msg.volumeId || undefined;
            let action = n.action || msg.action || msg.payload.action || undefined;
            let options = RED.util.evaluateNodeProperty(n.options, n.optionstype, n, msg) || msg.options || msg.payload.options || undefined;
            if (volumeId === undefined && !['list', 'prune', 'create'].includes(action)) {
                this.error("Volume id/name must be provided via configuration or via `msg.volume`");
                return;
            }
            this.status({});
            executeAction(volumeId, options, client, action, this, msg, send, done);
        });

        function executeAction(volumeId: string, options: any, client: Dockerode, action: string, node: Node, msg, send, done) {

            let volume = client.getVolume(volumeId);

            switch (action) {

                case 'list':
                    // https://docs.docker.com/engine/api/v1.40/#operation/VolumeList
                    client.listVolumes({ all: true })
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: volumeId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 400) {
                                node.error(`Bad parameter:  ${err.reason}`, msg);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`, msg);
                                node.send({ payload: err });
                            } else {
                                node.error(`System Error:  [${err.statusCode}] ${err.reason}`, msg);
                                return;
                            }
                        });
                    break;

                case 'inspect':
                    // https://docs.docker.com/engine/api/v1.40/#operation/VolumeInspect
                    volume.inspect()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: volumeId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            //                            404 No such volume
                            if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`, msg);
                                node.send({ payload: err });
                            } else {
                                node.error(`System Error:  [${err.statusCode}] ${err.reason}`, msg);
                                return;
                            }
                        });
                    break;
                case 'remove':
                    // https://docs.docker.com/engine/api/v1.40/#operation/VolumeDelete
                    volume.remove()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: volumeId + ' stopped' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such volume or volume driver`, msg);
                                node.send({ payload: err });
                            } else if (err.statusCode === 409) {
                                node.error(`Volume is in use and cannot be removed`, msg);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server error: [${err.statusCode}] ${err.reason}`, msg);
                                node.send({ payload: err });
                            } else {
                                node.error(`System Error:  [${err.statusCode}] ${err.reason}`, msg);
                                return;
                            }
                        });
                    break;
                case 'create':
                    // https://docs.docker.com/engine/api/v1.40/#operation/VolumeCreate
                    options.name  = volumeId;
                    client.createVolume(options).then(res => {
                        node.status({ fill: 'green', shape: 'dot', text: volumeId + ' created' });
                        send(Object.assign(msg, { payload: res }));
                        done();
                    }).catch(err => {
                        if (err.statusCode === 500) {
                            node.error(`Server Error: [${err.statusCode}] ${err.reason}`, msg);
                            node.send({ payload: err });
                        } else {
                            node.error(`System Error:  [${err.statusCode}] ${err.reason}`, msg);
                            return;
                        }
                    });
                    break;

                case 'prune':
                    // https://docs.docker.com/engine/api/v1.40/#operation/VolumePrune         
                    client.pruneVolumes()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: volumeId + ' stopped' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`, msg);
                                node.send({ payload: err });
                            } else {
                                node.error(`System Error:  [${err.statusCode}] ${err.reason}`, msg);
                                return;
                            }
                        });
                    break;

                default:
                    node.error(`Called with an unknown action: ${action}`, msg);
                    return;
            }
        }
    }

    RED.httpAdmin.post("/volumeSearch", RED.auth.needsPermission('flows.write'), function (req, res) {
        RED.log.debug("POST /volumeSearch");

        const nodeId = req.body.id;
        let config = RED.nodes.getNode(nodeId);

        discoverSonos(config, (volumes) => {
            RED.log.debug("GET /volumeSearch: " + volumes.length + " found");
            res.json(volumes);
        });
    });

    function discoverSonos(config, discoveryCallback) {
        let client = config.getClient();
        client.listVolumes({ all: true })
            //            .then(volumes => console.log(volumes))
            .then(volumes => discoveryCallback(volumes))
            .catch(err => this.error(err));
    }

    RED.nodes.registerType('docker-volume-actions', DockerVolumeAction);
}

