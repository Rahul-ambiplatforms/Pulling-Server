const express = require('express');
const axios = require('axios');
const path = require('path');
const https = require('https');
require('dotenv').config();
const app = express();
const port = 1010;

// Serve static files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});


async function fetchAndProcessData() {
    try {
        const rtspResponse = await axios.get(process.env.RTSP_API_URL,{httpsAgent});
        const rtspData = rtspResponse.data || [];
        const rtspStreamNames = rtspData
            .map(item => item.dvr_plan)
            .filter(name => name);

        const proxyResponse = await axios.get(process.env.PROXY_API_URL, {
            httpsAgent,
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.AUTH_USERNAME}:${process.env.AUTH_PASSWORD}`).toString('base64')}`
            }
        });

        const proxyData = proxyResponse.data || { proxies: [] };
        const proxies = proxyData.proxies || [];

        const deviceResponse = await axios.get(process.env.DEVICE_API_URL);
        const devices = deviceResponse.data || [];

        const updatedProxies = proxies.map(async proxy => {
            const device = devices.find(d => `RTSP-${d.deviceId}` === proxy.name);
            console.log('devices:',device)
            const remotePort = proxy.conf && proxy.conf.remotePort ? proxy.conf.remotePort : 0;
            const updatedProxy = {
                ...proxy,
                CloudStatus: rtspStreamNames.includes(proxy.name) ? 'Activated' : 'Deactivated',
                Plan: device ? device.plan : 'No Information',
                Quality: device ? device.quality : 'No Information',
                RemotePort: remotePort,
                mediaserver: device ? device.mediaUrl : "No Information",
            };
            // If status is 'online' and CloudStatus is 'Deactivated', call the API continuously
            if (proxy.status === 'online' && updatedProxy.mediaserver === process.env.CHECK_MEDIA_DOMAIN && updatedProxy.CloudStatus === 'Deactivated' &&  updatedProxy.Plan !== 'No Information') {

                const baseTarget = `rtsp://${process.env.CAMERA_AUTH_USERNAME}:${process.env.CAMERA_AUTH_PASSWORD}:@RTSP-${device.deviceId}.${process.env.CAMERA_DOMAIN}:${updatedProxy.RemotePort}/`;
                const streamSuffix = updatedProxy.Quality === 'low' ? 'ch0_1.264' : 'ch0_0.264';
                const encodedTarget = encodeURIComponent(baseTarget + streamSuffix);
                // const encodedTarget = encodeURIComponent(`rtsp://admin:@RTSP-${device.deviceid}.torqueverse.dev:${updatedProxy.RemotePort}/ch0_0.264`);
                console.log('Calling API for', device.deviceId);

                const url = `${process.env.MEDIA_SERVER_URL}?target=${encodedTarget}&streamPath=DVR/RTSP-${device.deviceId}&save=1`;
                console.log(url);

                // Continuously call the API
                axios.get(url)
                    .then(response => {
                        console.log('Stream pull response:', response.data);
                    })
                    .catch(error => {
                        console.error('Error pulling stream:', error);
                    });
            }

            return updatedProxy;
        });

        // console.log({ ...proxyData, proxies: updatedProxies });

    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

// Run the function every 10 seconds
const intervalTime = 10000; // 10 seconds
setInterval(fetchAndProcessData, intervalTime);

// Optionally, you can run it once immediately when the script starts
fetchAndProcessData();



app.get('/api/proxy', async (req, res) => {
    try {
        const rtspResponse = await axios.get(process.env.RTSP_API_URL,{httpsAgent});
        const rtspData = rtspResponse.data || [];
        const rtspStreamNames = rtspData
            .map(item => item.dvr_plan)
            .filter(name => name);

        const proxyResponse = await axios.get(process.env.PROXY_API_URL, {
            httpsAgent,
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.AUTH_USERNAME}:${process.env.AUTH_PASSWORD}`).toString('base64')}`
            }
        });

        const proxyData = proxyResponse.data || { proxies: [] };
        const proxies = proxyData.proxies || [];

        const deviceResponse = await axios.get(process.env.DEVICE_API_URL);
        const devices = deviceResponse.data || [];

        const updatedProxies = proxies.map(proxy => {
            const device = devices.find(d => `RTSP-${d.deviceId}` === proxy.name);
            return {
                ...proxy,
                CloudStatus: rtspStreamNames.includes(proxy.name) ? 'Activated' : 'Deactivated',
                Plan: device ? device.plan : 'No Information ',
                Quality: device ? device.quality : 'No Information',
            };
        });


        res.json({ ...proxyData, proxies: updatedProxies });

    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API endpoint to start the stream
app.get('/start-stream', async (req, res) => {
    let deviceid = req.query.deviceid;
    deviceid = deviceid.replace('RTSP-', '');
    const port = req.query.remoteport;
    try {
        // Fetch device details from the external API
        const deviceResponse = await axios.get(process.env.DEVICE_API_URL);
        const devices = deviceResponse.data; // Assuming the API returns an array of devices


        // Find the device with the matching deviceid
        // console.log(devices)
        const device = devices.find(d => d.deviceId === deviceid);

        if (device) {

            const encodedTarget = encodeURIComponent(`rtsp://${process.env.CAMERA_AUTH_USERNAME}:${process.env.CAMERA_AUTH_PASSWORD}:@RTSP-${device.deviceId}.${process.env.CAMERA_DOMAIN}:${port}/ch0_0.264`);
            // console.log(encodedTarget)
            const url = `${process.env.MEDIA_SERVER_URL}?target=${encodedTarget}&streamPath=DVR/RTSP-${device.deviceId}&save=1`;
            try {
                const response = await axios.get(url);
                res.json({ success: true, message: `Successfully pulled stream for ${device.plan}/RTSP-${device.deviceId}` });
            } catch (error) {
                console.error('Error in RTSP API call:', error.response ? error.response.data : error.message);
                res.json({ success: false, message: `Failed to pull stream for RTSP-${device.deviceId}`, error: error.response ? error.response.data : error.message });
            }
        } else {
            res.json({ success: false, message: 'Device not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch device details', error: error.message });
    }
});
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});