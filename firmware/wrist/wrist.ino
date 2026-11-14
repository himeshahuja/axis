// Wrist unit: an MPU6050 (accelerometer + gyroscope), one push button and one
// vibration motor, on an ESP32 or any Arduino-class board.
//
// Speaks plain text lines over Serial at 115200 baud:
//
//   out   I <ms> <ax> <ay> <az> <gx> <gy> <gz>   100 times a second (m/s^2, rad/s)
//         B <ms> <1|0>                            button went down (1) or up (0)
//   in    V <on ms> <off ms> <on ms> ...          run the motor in this pattern
//
// Wiring (change the pins below to suit the board):
//   MPU6050  VCC -> 3.3 V, GND -> GND, SDA -> SDA, SCL -> SCL (ESP32: 21, 22; Uno/Nano: A4, A5)
//   Button   one leg -> BUTTON_PIN, other leg -> GND (uses the internal pull-up)
//   Motor    MOTOR_PIN -> 1 k resistor -> base of an NPN transistor (2N2222);
//            emitter -> GND; collector -> motor -; motor + -> 3.3 V;
//            a diode (1N4148) across the motor, stripe toward 3.3 V.
//            Never drive the motor straight from a pin.
//
// For a wireless link on an ESP32, include "BluetoothSerial.h", make a
// BluetoothSerial called SerialBT, and use it in place of Serial below: the
// Pi then sees the same lines on a Bluetooth serial port (rfcomm).

#include <Wire.h>

const int BUTTON_PIN = 4;
const int MOTOR_PIN = 5;
const uint8_t MPU = 0x68;             // 0x69 if AD0 is tied high
const unsigned long PERIOD_US = 10000; // 100 readings a second

// Raw counts to physical units, for the ranges set in setup().
const float ACCEL_SCALE = 9.80665 / 8192.0;            // +-4 g
const float GYRO_SCALE = (3.14159265 / 180.0) / 65.5;  // +-500 degrees a second

unsigned long nextSample = 0;
bool buttonDown = false;
unsigned long buttonChanged = 0;

// The motor pattern being played: on, off, on, ... in milliseconds.
const int MAX_STEPS = 24;
unsigned int steps[MAX_STEPS];
int stepCount = 0, stepAt = 0;
unsigned long stepEnds = 0;

// The line being received.
char line[96];
int lineLen = 0;

void writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);
  Wire.begin();
  Wire.setClock(400000);
  writeReg(0x6B, 0x01);  // wake up, clock from the gyro
  writeReg(0x1A, 0x03);  // low-pass filter at about 42 Hz
  writeReg(0x1B, 0x08);  // gyro +-500 degrees a second
  writeReg(0x1C, 0x08);  // accelerometer +-4 g
  nextSample = micros();
}

void startPattern(char *text) {
  // "V 100 120 100": numbers after the V.
  stepCount = 0;
  char *p = text + 1;
  while (*p && stepCount < MAX_STEPS) {
    while (*p == ' ') p++;
    if (!*p) break;
    steps[stepCount++] = (unsigned int)strtoul(p, &p, 10);
  }
  stepAt = 0;
  if (stepCount > 0) {
    digitalWrite(MOTOR_PIN, HIGH);
    stepEnds = millis() + steps[0];
  }
}

void loop() {
  unsigned long now = millis();

  // Commands from the Pi.
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line[lineLen] = 0;
      if (lineLen > 1 && line[0] == 'V') startPattern(line);
      lineLen = 0;
    } else if (lineLen < (int)sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }

  // The motor pattern: even steps are on, odd steps are off.
  if (stepAt < stepCount && (long)(now - stepEnds) >= 0) {
    stepAt++;
    if (stepAt < stepCount) {
      digitalWrite(MOTOR_PIN, stepAt % 2 == 0 ? HIGH : LOW);
      stepEnds = now + steps[stepAt];
    } else {
      digitalWrite(MOTOR_PIN, LOW);
    }
  }

  // The button, ignoring bounce for 25 ms after each change.
  bool down = digitalRead(BUTTON_PIN) == LOW;
  if (down != buttonDown && now - buttonChanged > 25) {
    buttonDown = down;
    buttonChanged = now;
    Serial.print("B ");
    Serial.print(now);
    Serial.println(down ? " 1" : " 0");
  }

  // A reading, 100 times a second.
  if ((long)(micros() - nextSample) >= 0) {
    nextSample += PERIOD_US;
    Wire.beginTransmission(MPU);
    Wire.write(0x3B);  // accelerometer x high byte; 14 bytes follow
    Wire.endTransmission(false);
    Wire.requestFrom(MPU, (uint8_t)14);
    if (Wire.available() == 14) {
      int16_t raw[7];
      for (int i = 0; i < 7; i++) {
        uint8_t high = Wire.read();
        raw[i] = (int16_t)((high << 8) | Wire.read());
      }
      // raw[3] is the chip's temperature, not sent.
      Serial.print("I ");
      Serial.print(now);
      for (int i = 0; i < 3; i++) { Serial.print(' '); Serial.print(raw[i] * ACCEL_SCALE, 3); }
      for (int i = 4; i < 7; i++) { Serial.print(' '); Serial.print(raw[i] * GYRO_SCALE, 4); }
      Serial.println();
    }
  }
}
