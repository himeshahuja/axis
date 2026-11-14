# Air-writing trainer

Guided data collection + live IMU view + a model that retrains itself after every sample.

```
pip install -r requirements.txt
python server.py --source sim            # no hardware: fake wristband, try the UI
python server.py --source serial --port /dev/ttyUSB0 --labels 0123456789
python server.py --source udp --port 9000    # ESP32 / Pi sending UDP lines
```
Open http://localhost:8000 (or http://<pi-ip>:8000 from another machine).

## IMU line format (one per sample, ~100 Hz)
`ax,ay,az,gx,gy,gz[,btn]` : accel in **g**, gyro in **deg/s**, optional `btn` level (0/1).
Each 0->1 edge of `btn` toggles start/stop. Without a button, use Space or the Start button.
Example Arduino line: `Serial.println(String(ax)+","+String(ay)+","+String(az)+","+String(gx)+","+String(gy)+","+String(gz)+","+String(digitalRead(BTN)==LOW));`

## Using it
1. Hold the wrist still ~1 s (the server tracks gyro bias while idle).
2. Press the button / Space, write the big letter on the left, press again.
3. The right side shows the live signal, the exact window the model sees, the model's guess
   (made *before* it trains on that sample), online accuracy, and a confusion matrix.
4. Keys: Space = start/stop, N = skip letter, U = undo last sample.
5. Type a name in "Person" before each person starts, so data is saved per person.
6. Mode `test` = write anything and see the prediction; nothing is saved or trained.

## Data
Every sample is saved to `data/<person>/<label>_<timestamp>.npz` (raw IMU `raw` (T,6), `label`,
`person`, `hz`, `bias`). Existing data is reloaded on startup, so you can stop and resume.
For a proper evaluation, train offline with leave-one-person-out over these folders.

## Notes
- Preprocessing: accel relative to the start pose, gyro bias removed, resampled to 64 steps, fixed scaling.
- Model: small 1D CNN, retrained (warm start, 30 epochs, light augmentation) after each new sample once there are 10.
- Options: `--labels`, `--goal` (samples per label), `--data`, `--person`, `--http-port`.
