import { Red, Node } from 'node-red';
import { DockerConfiguration } from './docker-configuration';
import * as Dockerode from 'dockerode';
let stream = require('stream');

module.exports = function (RED: Red) {


    function DockerContainerAction(n: any) {
        RED.nodes.createNode(this, n);
        let config = RED.nodes.getNode(n.config) as unknown as DockerConfiguration;
        let client = config.getClient();

        this.on('input', (msg) => {
            let cmd = n.options || msg.cmd || msg.comand || msg.payload?.comand || undefined;
            let image = RED.util.evaluateNodeProperty(n.image, n.imagetype, n, msg);
            let action = n.action || msg.action || msg.payload?.action || undefined;
            let options = msg.options || msg.options || msg.payload?.options || RED.util.evaluateNodeProperty(n.options, n.optionstype, n, msg) || undefined;
            let containerId: string = n.container || msg.payload?.containerId || msg.containerId || msg.payload?.containerName || msg.containerName || undefined;

            if (containerId === undefined && !['list', 'prune', 'create', 'pull', 'run'].includes(action)) {
                this.error("Container id/name must be provided via configuration or via `msg.containerId`");
                return;
            }
            this.status({});

            executeAction(containerId, options, cmd, client, action, this, msg, image, {
                cmd: cmd,
                pullimage: n.pullimage,
                createOptions: RED.util.evaluateNodeProperty(n.createOptions !== '' ? n.createOptions : '{}', n.createOptionsType, n, msg) || {},
                startOptions: RED.util.evaluateNodeProperty(n.startOptions !== '' ? n.startOptions : '{}', n.startOptionsType, n, msg)
            });
        });


        async function executeAction(containerId: string, options: any, cmd: string, client: Dockerode, action: string, node: Node, msg, image, config) {
            let container = client.getContainer(containerId);

            switch (action) {
                case 'pull':
                    client.pull(image, { "disable-content-trust": "false" }, function (_err, pull) {
                        client.modem.followProgress(pull, (_err, _output) => {
                            node.send(Object.assign(msg, { payload: {} }));
                        });
                    });
                    break;

                case 'run':
                    if (config.pullimage) {
                        client.pull(image, { "disable-content-trust": "false" }, function (_err, pull) {
                            client.modem.followProgress(pull, (_err, _output) => {
                                //@ts-ignore
                                client.run(image, [config.cmd], false, config.createOptions, config.startOptions, (err, data, container) => {
                                    if (err) {
                                        node.error(err);
                                        node.send(Object.assign(msg, { payload: {}, err: err }))
                                    }
                                }).on('stream', (stream) => {
                                    stream.on('data', data => node.send({ payload: data.toString() }));
                                }).on('error', (err) => {
                                    node.error(err);
                                });
                            });
                        });
                    } else {
                        //@ts-ignore
                        client.run(image, ['sh', '-c', config.cmd], false, config.createOptions, config.startOptions, (err, data, container) => {
                            if (err) {
                                node.error(err);
                                node.send(Object.assign(msg, { payload: {}, err: err }))
                            }
                        }).on('stream', (stream) => {
                            stream.on('data', data => node.send({ payload: data.toString() }));
                        }).on('error', (err) => {
                            node.error(err);
                        });
                    }
                    break;

                case 'exec':
                    let execOptions = {
                        Cmd: ['sh', '-c', cmd],
                        AttachStdout: true,
                        AttachStderr: true
                    };
                    container.exec(execOptions)
                        .then(res => {
                            if (res) {
                                res.start((err, input_stream) => {
                                    if (err) {
                                        //console.log("error : " + err);
                                        return;
                                    }

                                    var stdout = new stream.PassThrough();
                                    var stderr = new stream.PassThrough();
                                    container.modem.demuxStream(input_stream, stdout, stderr);

                                    let buffer_stdout = "";
                                    stdout.on('data', (chunk) => {
                                        buffer_stdout += chunk.toString();
                                    });

                                    let buffer_stderr = "";
                                    stderr.on('data', (chunk) => {
                                        buffer_stderr += chunk.toString();
                                    });

                                    input_stream.on('end', () => {
                                        node.send(Object.assign(msg, { payload: buffer_stdout }));
                                        if (buffer_stderr.trim().length > 0) {
                                            node.error(`Error exec container: ${buffer_stderr}`);
                                        }
                                    });
                                });
                            }

                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'list':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerList
                    client.listContainers({ all: true })
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 400) {
                                node.error(`Bad parameter:  ${err.reason}`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'inspect':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerInspect
                    container.inspect()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'top':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerTop
                    container.top()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' killed' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'logs':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerLogs
                    container.logs()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' restarted' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'changes':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerChanges
                    container.changes()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'export':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerExport
                    container.export()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;
                // TODO: make this it own objects
                case 'stats':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerStats

                    container.stats().then((events: any) => {

                        node.status({ fill: 'green', shape: 'dot', text: 'node-red:common.status.connected' });

                        events.on('data', (data) => {
                            let event: any = {};
                            try {
                                event = JSON.parse(data.toString());
                            } catch (e) {
                                node.error('Error parsing JSON', e);
                                return
                            }

                            node.send({
                                _msgid: RED.util.generateId(),
                                type: event.Type,
                                action: event.Action,
                                time: event.time,
                                timeNano: event.timeNano,
                                payload: event
                            });
                        });

                        events.on('close', () => {
                            node.status({ fill: 'red', shape: 'ring', text: 'node-red:common.status.disconnected' });
                            node.warn('Docker event stream closed.');
                        });
                        events.on('error', (err) => {
                            node.status({ fill: 'red', shape: 'ring', text: 'node-red:common.status.disconnected' });
                            node.error('Error:', err);
                        });
                        events.on('end', () => {
                            node.status({ fill: 'yellow', shape: 'ring', text: 'stream ended' });
                            node.warn('Docker event stream ended.');
                        });
                    });

                    break;

                case 'resize':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerResize
                    container.resize()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'start':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerStart
                    container.start()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'stop':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerStop
                    container.stop()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' stopped' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'restart':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerRestart
                    container.restart()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' restarted' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'kill':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerKill
                    container.kill()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' killed' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'update':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerUpdate
                    container.update(options)
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'rename':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerRename
                    container.rename(options)
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 409) {
                                node.error(`Name already in use: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'pause':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerPause
                    container.pause()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' stopped' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'unpause':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerUnpause
                    container.unpause()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' stopped' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'attach':
                    /*
                                      
                                            container.attach(execOptions)
                                                .then(res => {
                                                    if (res) {
                                                        res.start((err, input_stream) => {
                                                            if (err) {
                                                                //console.log("error : " + err);
                                                                return;
                                                            }
                        
                                                            var stdout = new stream.PassThrough();
                                                            var stderr = new stream.PassThrough();
                                                            container.modem.demuxStream(input_stream, stdout, stderr);
                        
                                                            let buffer_stdout = "";
                                                            stdout.on('data', (chunk) => {
                                                                buffer_stdout += chunk.toString();
                                                            });
                        
                                                            let buffer_stderr = "";
                                                            stderr.on('data', (chunk) => {
                                                                buffer_stderr += chunk.toString();
                                                            });
                        
                                                            input_stream.on('end', () => {
                                                                node.send(Object.assign(msg,{ payload: buffer_stdout }));                                       
                                                                if(buffer_stderr.trim().length>0){
                                                                    node.error(`Error exec container: ${buffer_stderr}`);
                                                                }
                                                            });
                                                        });
                                                    }
                        
                                                }).catch(err => {
                                                    if (err.statusCode === 404) {
                                                        node.error(`No such container: [${containerId}]`);
                                                        node.send({ payload: err });
                                                    } else if (err.statusCode === 500) {
                                                        node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                                        node.send({ payload: err });
                                                    } else {
                                                        node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                                        return;
                                                    }
                                                });
                                            break;
                                            */
                    /*
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerAttach
                    container.attach(options)
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg,{ payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 400) {
                                node.error(`Bad parameter: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        }); */
                    break;
                /*
                //TODO: not found in dockerode
                                    case 'attach-ws':
                                        // https://docs.docker.com/engine/api/v1.40/#operation/ContainerAttachWebsocket
                                        container.attach-ws()
                                            .then(res => {
                                                node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                                                node.send(Object.assign(msg,{ payload: res }));
                                            }).catch(err => {
                                                if (err.statusCode === 404) {
                                                    node.error(`No such container: [${containerId}]`);
                                                    node.send({ payload: err });
                                                } else if (err.statusCode === 400) {
                                                    node.error(`Bad parameter: [${err.statusCode}] ${err.reason}`);
                                                    node.send({ payload: err });
                                                } else if (err.statusCode === 500) {
                                                    node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                                    node.send({ payload: err });
                                                } else {
                                                    node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                                    return;
                                                }
                                            });
                                        break;
                */

                case 'wait':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerWait
                    container.wait()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' killed' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'remove':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerDelete
                    container.remove()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' killed' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'archive-info':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerArchiveInfo
                    container.infoArchive({ 'path': cmd })
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' killed' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`Container or path does not exist: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                console.log(err);
                                return;
                            }
                        });
                    break;

                case 'get-archive':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerArchive
                    container.getArchive(options)
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' killed' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`Container or path does not exist: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                /*
                //TODO: fix file option
                                case 'putArchive':
                                    // https://docs.docker.com/engine/api/v1.40/#operation/PutContainerArchive
                                    container.putArchive(file, options)
                                        .then(res => {
                                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' killed' });
                                            node.send(Object.assign(msg,{ payload: res }));
                                        }).catch(err => {
                                            if (err.statusCode === 404) {
                                                node.error(`No such container or path does not exist inside the container: [${containerId}]`);
                                                node.send({ payload: err });
                                            } else if (err.statusCode === 400) {
                                                node.error(`Bad parameter: [${err.statusCode}] ${err.reason}`);
                                                node.send({ payload: err });
                                            } else if (err.statusCode === 403) {
                                                node.error(` Permission denied, the volume or container rootfs is marked as read-only.: [${err.statusCode}] ${err.reason}`);
                                                node.send({ payload: err });
                                            } else if (err.statusCode === 500) {
                                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                                node.send({ payload: err });
                                            } else {
                                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                                return;
                                            }
                                        });
                                    break;
                */

                //TODO: not found in dockerode
                case 'prune':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerPrune
                    client.pruneContainers()
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 404) {
                                node.error(`No such container: [${containerId}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;

                case 'create':
                    // https://docs.docker.com/engine/api/v1.40/#operation/ContainerCreate
                    client.createContainer(options)
                        .then(res => {
                            node.status({ fill: 'green', shape: 'dot', text: containerId + ' started' });
                            node.send(Object.assign(msg, { payload: res }));
                        }).catch(err => {
                            if (err.statusCode === 400) {
                                node.error(`Bad parmeter: [${err.reason}]`);
                                node.send({ payload: err });
                            } else if (err.statusCode === 500) {
                                node.error(`Server Error: [${err.statusCode}] ${err.reason}`);
                                node.send({ payload: err });
                            } else {
                                node.error(`Sytem Error:  [${err.statusCode}] ${err.reason}`);
                                return;
                            }
                        });
                    break;
                default:
                    node.error(`Called with an unknown action: ${action}`);
                    return;
            }
        }
    }

    RED.httpAdmin.post("/containerSearch", function (req, res) {
        RED.log.debug("POST /containerSearch");

        const nodeId = req.body.id;
        let config = RED.nodes.getNode(nodeId);

        discoverSonos(config, (containers) => {
            RED.log.debug("GET /containerSearch: " + containers.length + " found");
            res.json(containers);
        });
    });

    function discoverSonos(config, discoveryCallback) {
        let client = config.getClient();
        client.listContainers({ all: true })
            .then(containers => discoveryCallback(containers))
            .catch(err => this.error(err));
    }

    RED.nodes.registerType('docker-container-actions', DockerContainerAction);
}

