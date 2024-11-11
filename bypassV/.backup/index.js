const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 8787;

app.use(express.urlencoded({ extended: true }));

// Function to get Ngrok URL from config.json
function getNgrokUrl() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.ngrokUrl;
    } catch (error) {
        console.error('Error reading config file: ', error);
        return null;
    }
}

// Get Ngrok URL
const ngrokUrl = getNgrokUrl();

if (!ngrokUrl) {
    console.error('Ngrok URL is not defined. Please check the config.json file.');
    process.exit(1);
}

// Serve HLS files
const hlsDirectory = path.join(__dirname, 'hls');
app.use('/hls', express.static(hlsDirectory));

if (!fs.existsSync(hlsDirectory)) {
    fs.mkdirSync(hlsDirectory);
}

let ffmpegPid = null;

// Function to delete HLS files
function deleteHLSFiles() {
    fs.readdir(hlsDirectory, (err, files) => {
        if (err) {
            console.error('Error reading HLS directory for deletion:', err);
            return;
        }

        const deletePromises = files.map(file => {
            return new Promise((resolve, reject) => {
                fs.unlink(path.join(hlsDirectory, file), err => {
                    if (err) {
                        console.error('Error deleting HLS file:', err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        });

        Promise.all(deletePromises)
            .then(() => {
                console.log('HLS files deleted successfully.');
            })
            .catch(err => {
                console.error('Error deleting HLS files:', err);
            });
    });
}

// Serve the home page with a form
app.get('/', (req, res) => {
    // Check if HLS files exist
    fs.readdir(hlsDirectory, (err, files) => {
        const hlsFilesExist = files && files.length > 0;
        const stopButtonEnabled = ffmpegPid !== null || hlsFilesExist;

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title><<< bypassV >>></title> <!-- Updated Title -->
                <style>
                    /* Base Styles */
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        padding: 20px;
                        box-sizing: border-box;
                        background-color: black; /* Set background to black */
                        color: white; /* Ensure text is visible on black background */
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        min-height: 100vh;
                    }
                    h1 {
                        text-align: center;
                        margin-bottom: 20px;
                    }
		    h6 {
		        text-align: center;
			margin-bottom: 20px;
		       }	
                    form {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        width: 100%;
                        max-width: 400px;
                        margin: 0 auto 20px auto;
                    }
                    input[type="text"] {
                        width: 100%;
                        padding: 10px;
                        margin-bottom: 10px;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                        box-sizing: border-box;
                        font-size: 16px;
                        background-color: #333; /* Dark input background */
                        color: white; /* Input text color */
                        border: 1px solid #555; /* Darker border */
                    }
                    input[type="text"]::placeholder {
                        color: #bbb; /* Placeholder color */
                    }
                    button[type="submit"] {
                        padding: 10px 20px;
                        border: none;
                        border-radius: 4px;
                        background-color: #28a745;
                        color: white;
                        cursor: pointer;
                        width: 100%;
                        max-width: 200px;
                        margin-bottom: 10px;
                        transition: background-color 0.3s;
                        font-size: 16px;
                    }
                    button[type="submit"]:hover {
                        background-color: #218838;
                    }
                    #stop-streaming {
                        padding: 10px 20px;
                        border: none;
                        border-radius: 4px;
                        background-color: #dc3545;
                        color: white;
                        cursor: pointer;
                        width: 100%;
                        max-width: 200px;
                        margin-top: 10px;
                        transition: background-color 0.3s;
                        font-size: 16px;
                    }
                    #stop-streaming:disabled {
                        background-color: #6c757d;
                        cursor: not-allowed;
                    }
                    #stop-streaming:hover:not(:disabled) {
                        background-color: #c82333;
                    }

                    /* Media Queries */
                    @media (min-width: 600px) {
                        form {
                            flex-direction: row;
                            justify-content: center;
                        }
                        input[type="text"] {
                            margin-right: 10px;
                            margin-bottom: 0;
                        }
                        button[type="submit"], #stop-streaming {
                            width: auto;
                            margin-top: 0;
                        }
                        #stop-streaming {
                            margin-left: 10px;
                        }
                    }
                </style>
            </head>
            <body>
                <h1><<< bypassV >>></h1>
		<h6>[restriction bypass v1.1]</h6>
                <form action="/stream" method="POST">
                    <input type="text" name="videoUrl" placeholder="YouTube Video URL" required style="width: 300px;">
                    <button type="submit">Stream Video</button>
                </form>
                <div style="display: flex; justify-content: center; width: 100%; max-width: 400px;">
                    <button id="stop-streaming" ${stopButtonEnabled ? '' : 'disabled'}>Stop Streaming</button>
                </div>
                <script>
                    document.getElementById('stop-streaming').addEventListener('click', function() {
                        fetch('/stop', { method: 'POST' })
                            .then(response => response.text())
                            .then(data => {
                                alert(data);
                                location.reload(); // Refresh the page after stopping
                            })
                            .catch(error => {
                                console.error('Error stopping streaming:', error);
                            });
                    });
                </script>
            </body>
            </html>
        `);
    });
});

// Helper function to convert duration to seconds
function durationToSeconds(duration) {
    const parts = duration.split(':').map(part => parseInt(part, 10));
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
        return parts[0];
    }
    return 0;
}

// Handle the stream request
app.post('/stream', (req, res) => {
    const videoUrl = req.body.videoUrl;

    if (!videoUrl) {
        return res.status(400).send('Error: No video URL provided.');
    }

    const ytdlpCommand = `yt-dlp --get-duration "${videoUrl}" && yt-dlp -f best -g "${videoUrl}"`;
    exec(ytdlpCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error fetching video URL: ${error.message}`);
            console.error(`yt-dlp stderr: ${stderr}`);
            return res.status(500).send('Error fetching video URL.');
        }

        const output = stdout.trim().split('\n');
        const durationStr = output[0];
        const directVideoUrl = output[1];

        if (!directVideoUrl) {
            console.error('No direct video URL found.');
            return res.status(500).send('Error fetching video URL.');
        }

        const durationSeconds = durationToSeconds(durationStr);
        if (durationSeconds === 0) {
            console.error('Invalid video duration.');
            return res.status(500).send('Error processing video duration.');
        }

        // Clear existing HLS files before starting a new stream
        deleteHLSFiles();

        const ffmpegCommand = [
            '-i', directVideoUrl,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '22',
            '-g', '60',
            '-hls_time', '2',
            '-hls_list_size', '0',
            '-f', 'hls',
            path.join(hlsDirectory, 'stream.m3u8')
        ];

        const ffmpegProcess = spawn('ffmpeg', ffmpegCommand);
        ffmpegPid = ffmpegProcess.pid;

        ffmpegProcess.stdout.on('data', (data) => {
            console.log(`ffmpeg stdout: ${data}`);
        });

        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`ffmpeg stderr: ${data}`);
        });

        ffmpegProcess.on('exit', (code, signal) => {
            console.log(`ffmpeg process exited with code ${code} and signal ${signal}`);
            ffmpegPid = null; // Reset ffmpegPid when streaming is done
            // HLS files remain for potential cleanup
        });

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>bypassv - Streaming</title> <!-- Updated Title -->
                <style>
                    /* Base Styles */
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        padding: 20px;
                        box-sizing: border-box;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        background-color: black; /* Set background to black */
                        color: white; /* Ensure text is visible on black background */
                        min-height: 100vh;
                    }
                    h2 {
                        text-align: center;
                        margin-bottom: 20px;
                    }
                    #player {
                        width: 100%;
                        max-width: 800px;
                        height: auto;
                        aspect-ratio: 16 / 9; /* Default to landscape */
                        background-color: black;
                    }
                    .controls {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        margin-top: 10px;
                        width: 100%;
                        max-width: 800px;
                    }
                    .time-display {
                        margin-bottom: 10px;
                        font-size: 18px;
                    }
                    button {
                        padding: 10px 20px;
                        border: none;
                        border-radius: 4px;
                        background-color: #dc3545;
                        color: white;
                        cursor: pointer;
                        width: 100%;
                        max-width: 200px;
                        margin-top: 10px;
                        transition: background-color 0.3s;
                        font-size: 16px;
                    }
                    button:hover {
                        background-color: #c82333;
                    }

                    /* Media Queries */
                    @media (max-width: 599px) {
                        #player {
                            aspect-ratio: 9 / 16; /* Portrait for mobile */
                        }
                        .time-display {
                            font-size: 16px;
                        }
                        button {
                            width: 90%;
                            max-width: none;
                        }
                    }
                    @media (min-width: 600px) {
                        .controls {
                            flex-direction: row;
                            justify-content: space-between;
                        }
                        .time-display {
                            margin-bottom: 0;
                            margin-right: 20px;
                        }
                        button {
                            width: auto;
                            margin-top: 0;
                        }
                    }
                </style>
            </head>
            <body>
                <h2>Streaming Video...</h2>
                <div id="player"></div>
                <div class="controls">
                    <div class="time-display">
                        <span id="current-time">0:00</span> / <span id="duration">${durationStr}</span>
                    </div>
                    <button id="stop-streaming">Stop Streaming</button>
                </div>
                <script src="https://cdn.jsdelivr.net/npm/clappr@latest/dist/clappr.min.js"></script>
                <script>
                    const player = new Clappr.Player({
                        source: "${ngrokUrl}/hls/stream.m3u8",
                        parentId: '#player',
                        autoPlay: true,
                        mute: false,
                        controls: true,
                        width: '100%',
                        height: '100%',
                        responsive: true
                    });

                    player.on(Clappr.Events.PLAYER_TIMEUPDATE, function() {
                        const currentTime = Math.floor(player.getCurrentTime());
                        const currentTimeFormatted = formatTime(currentTime);
                        document.getElementById('current-time').innerText = currentTimeFormatted;
                    });

                    function formatTime(seconds) {
                        const mins = Math.floor(seconds / 60);
                        const secs = seconds % 60;
                        return mins + ':' + (secs < 10 ? '0' + secs : secs);
                    }

                    document.getElementById('stop-streaming').addEventListener('click', function() {
                        fetch('/stop', { method: 'POST' })
                            .then(response => response.text())
                            .then(data => {
                                alert(data);
                                player.destroy();
                                window.location.href = '/'; // Redirect to home after stopping
                            })
                            .catch(error => {
                                console.error('Error stopping streaming:', error);
                            });
                    });
                </script>
            </body>
            </html>
        `);
    });
});

// Stop streaming route
app.post('/stop', (req, res) => {
    if (ffmpegPid) {
        console.log(`Stopping ffmpeg process with PID: ${ffmpegPid}`);
        exec(`kill -9 ${ffmpegPid}`, (error) => {
            if (error) {
                console.error(`Error stopping ffmpeg process: ${error.message}`);
                return res.status(500).send('Error stopping stream.');
            }
            console.log('ffmpeg process stopped successfully.');
            ffmpegPid = null; // Reset ffmpegPid
        });
    }

    // Delete HLS files
    deleteHLSFiles();
    return res.send('Streaming has been stopped and HLS files deleted.');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

