
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SoftwareSerial.h>
#include <math.h>

// =====================================================
// AGRI-TEK — ARDUINO UNO
// =====================================================

// Pin configuration
#define SOIL_PIN A0
#define DHT_PIN 2
#define DHT_TYPE DHT22
#define RAIN_PIN 3
#define PUMP_PIN 7

// Uno RX <- ESP32 TX
// Uno TX -> level shifter/divider -> ESP32 RX
#define ESP_RX_PIN 10
#define ESP_TX_PIN 11

// Hardware settings
const bool RAIN_LOW_MEANS_WET = true;

// false means LOW activates the pump driver.
// Verify this setting for your actual driver/relay.
const bool PUMP_ACTIVE_HIGH = false;

// Soil calibration: replace with measured values.
const int SOIL_DRY_RAW = 370;
const int SOIL_WET_RAW = 2;

// Hysteresis thresholds
int moistureStartThreshold = 35;
int moistureStopThreshold = 45;

// Timing settings
const unsigned long MAX_PUMP_RUN_MS = 15000UL;
const unsigned long PUMP_COOLDOWN_MS = 30000UL;
const unsigned long SENSOR_INTERVAL_MS = 2000UL;
const unsigned long LCD_INTERVAL_MS = 2000UL;

// =====================================================
// OBJECTS
// =====================================================

DHT dht(DHT_PIN, DHT_TYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);
SoftwareSerial espSerial(ESP_RX_PIN, ESP_TX_PIN);

// =====================================================
// STATE
// =====================================================

bool autoMode = true;
bool manualPumpRequest = false;
bool pumpOn = false;
bool rainWet = false;
bool pumpLockout = false;
bool sensorsReady = false;

int soilRaw = 0;
int moisturePercent = 0;

float temperatureC = NAN;
float humidityPercent = NAN;

unsigned long lastSensorRead = 0;
unsigned long lastLCDUpdate = 0;
unsigned long pumpStartedAt = 0;
unsigned long lastPumpStoppedAt = 0;

String commandBuffer = "";

// =====================================================
// PUMP OUTPUT
// =====================================================

void writePumpOutput(bool on) {
  bool outputHigh = PUMP_ACTIVE_HIGH ? on : !on;
  digitalWrite(PUMP_PIN, outputHigh ? HIGH : LOW);
}

void stopPump() {
  if (pumpOn) {
    pumpOn = false;
    writePumpOutput(false);

    lastPumpStoppedAt = millis();
    pumpLockout = true;
  }
}

bool cooldownComplete() {
  if (!pumpLockout) {
    return true;
  }

  if (millis() - lastPumpStoppedAt >= PUMP_COOLDOWN_MS) {
    pumpLockout = false;
    return true;
  }

  return false;
}

void setPump(bool requestedOn) {
  if (!requestedOn) {
    stopPump();
    return;
  }

  // Safety interlocks
  if (!sensorsReady || rainWet || pumpLockout) {
    return;
  }

  if (!pumpOn) {
    pumpOn = true;
    pumpStartedAt = millis();
    writePumpOutput(true);
  }
}

// =====================================================
// SENSOR READINGS
// =====================================================

void readSensors() {
  soilRaw = analogRead(SOIL_PIN);

  // Assumes a higher raw reading means drier soil.
  long mappedMoisture = map(
    soilRaw,
    SOIL_DRY_RAW,
    SOIL_WET_RAW,
    0,
    100
  );

  moisturePercent = constrain(mappedMoisture, 0, 100);

  int rainValue = digitalRead(RAIN_PIN);

  rainWet = RAIN_LOW_MEANS_WET
    ? (rainValue == LOW)
    : (rainValue == HIGH);

  temperatureC = dht.readTemperature();
  humidityPercent = dht.readHumidity();

  sensorsReady = true;
}

// =====================================================
// IRRIGATION CONTROL
// =====================================================

void updatePumpLogic() {
  if (!sensorsReady) {
    stopPump();
    return;
  }

  // Enforce maximum continuous run time.
  if (pumpOn &&
      millis() - pumpStartedAt >= MAX_PUMP_RUN_MS) {
    manualPumpRequest = false;
    stopPump();
    return;
  }

  // Rain always overrides all watering requests.
  if (rainWet) {
    manualPumpRequest = false;
    stopPump();
    return;
  }

  // Do not allow watering during cooldown.
  if (!cooldownComplete()) {
    stopPump();
    return;
  }

  if (autoMode) {
    // Start when soil is dry.
    if (!pumpOn &&
        moisturePercent <= moistureStartThreshold) {
      setPump(true);
    }

    // Stop when soil reaches the upper threshold.
    else if (pumpOn &&
             moisturePercent >= moistureStopThreshold) {
      stopPump();
    }

    // Between thresholds, keep the current pump state.
  } else {
    setPump(manualPumpRequest);
  }
}

// =====================================================
// ESP32 DATA TRANSMISSION
// =====================================================

void sendDataToESP() {
  // DATA,soilRaw,moisture,temp,humidity,rainWet,pumpOn,mode

  espSerial.print("DATA,");
  espSerial.print(soilRaw);
  espSerial.print(",");
  espSerial.print(moisturePercent);
  espSerial.print(",");

  if (isnan(temperatureC)) {
    espSerial.print("nan");
  } else {
    espSerial.print(temperatureC, 1);
  }

  espSerial.print(",");

  if (isnan(humidityPercent)) {
    espSerial.print("nan");
  } else {
    espSerial.print(humidityPercent, 1);
  }

  espSerial.print(",");
  espSerial.print(rainWet ? 1 : 0);
  espSerial.print(",");
  espSerial.print(pumpOn ? 1 : 0);
  espSerial.print(",");
  espSerial.println(autoMode ? "AUTO" : "MANUAL");
}

// =====================================================
// LCD DISPLAY
// =====================================================

void updateLCD() {
  static bool showEnvironment = false;

  if (millis() - lastLCDUpdate >= LCD_INTERVAL_MS) {
    lastLCDUpdate = millis();
    showEnvironment = !showEnvironment;
  }

  // Clear both lines to avoid leftover characters.
  lcd.setCursor(0, 0);
  lcd.print("                ");
  lcd.setCursor(0, 1);
  lcd.print("                ");

  if (showEnvironment) {
    lcd.setCursor(0, 0);
    lcd.print("Temp: ");

    if (isnan(temperatureC)) {
      lcd.print("--.-");
    } else {
      lcd.print(temperatureC, 1);
    }

    lcd.print((char)223);
    lcd.print("C");

    lcd.setCursor(0, 1);
    lcd.print("Humidity: ");

    if (isnan(humidityPercent)) {
      lcd.print("--");
    } else {
      lcd.print(humidityPercent, 0);
    }

    lcd.print("%");
  } else {
    lcd.setCursor(0, 0);
    lcd.print("Soil: ");
    lcd.print(moisturePercent);
    lcd.print("%");

    lcd.setCursor(0, 1);
    lcd.print("Rain:");
    lcd.print(rainWet ? "YES" : "NO");
    lcd.print(" Pump:");
    lcd.print(pumpOn ? "ON" : "OFF");
  }
}

// =====================================================
// COMMAND PROCESSING
// =====================================================

void processCommand(String command) {
  command.trim();

  if (command == "PUMP,1") {
    if (!autoMode && !rainWet && sensorsReady) {
      manualPumpRequest = true;
    }
  }
  else if (command == "PUMP,0") {
    manualPumpRequest = false;
    stopPump();
  }
  else if (command == "MODE,AUTO") {
    autoMode = true;
    manualPumpRequest = false;
    stopPump();
  }
  else if (command == "MODE,MANUAL") {
    autoMode = false;
    manualPumpRequest = false;
    stopPump();
  }
  else if (command.startsWith("THRESH,")) {
    int value = command.substring(7).toInt();

    moistureStartThreshold = constrain(value, 0, 90);
    moistureStopThreshold = moistureStartThreshold + 10;
  }
}

void readESPCommands() {
  while (espSerial.available()) {
    char c = espSerial.read();

    if (c == '\n') {
      processCommand(commandBuffer);
      commandBuffer = "";
    }
    else if (c != '\r' && commandBuffer.length() < 80) {
      commandBuffer += c;
    }
  }
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  // Establish the OFF output level before enabling the pin.
  digitalWrite(
    PUMP_PIN,
    PUMP_ACTIVE_HIGH ? LOW : HIGH
  );
  pinMode(PUMP_PIN, OUTPUT);
  writePumpOutput(false);

  pinMode(RAIN_PIN, INPUT);

  Serial.begin(9600);
  espSerial.begin(9600);

  dht.begin();

  lcd.init();
  lcd.backlight();

  lcd.setCursor(0, 0);
  lcd.print("Agri-Tek");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");

  delay(1500);
  lcd.clear();

  Serial.println("Agri-Tek started.");
  Serial.println("Pump starts disabled until sensors are read.");
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  // Handle ESP32 commands continuously.
  readESPCommands();

  // Read sensors at the selected interval.
  if (millis() - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = millis();

    readSensors();
    updateLCD();
    sendDataToESP();

    Serial.print("Soil raw: ");
    Serial.print(soilRaw);

    Serial.print(" | Moisture: ");
    Serial.print(moisturePercent);
    Serial.print("%");

    Serial.print(" | Temperature: ");
    if (isnan(temperatureC)) Serial.print("ERROR");
    else Serial.print(temperatureC, 1);

    Serial.print(" C | Humidity: ");
    if (isnan(humidityPercent)) Serial.print("ERROR");
    else Serial.print(humidityPercent, 1);

    Serial.print("% | Rain: ");
    Serial.print(rainWet ? "YES" : "NO");

    Serial.print(" | Pump: ");
    Serial.print(pumpOn ? "ON" : "OFF");

    Serial.print(" | Mode: ");
    Serial.println(autoMode ? "AUTO" : "MANUAL");
  }

  // Run control logic every loop, not just every 2 seconds.
  updatePumpLogic();
}