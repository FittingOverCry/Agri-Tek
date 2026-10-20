
#include <WiFi.h>
#include <WebServer.h>

// Enter your Wi-Fi credentials locally
const char* ssid = "Airtel_Sachin5G";
const char* password = "Sunita@1981";

// Web server
WebServer server(80);

// ESP32 Serial2 pins
// RX2 = GPIO16 receives from Uno TX
// TX2 = GPIO17 sends to Uno RX
const int ESP_RX_PIN = 16;
const int ESP_TX_PIN = 17;

String receivedLine = "";
String soilRaw = "null";
String moisture = "null";
String temperature = "null";
String humidity = "null";
String rain = "null";
String pump = "null";
String mode = "\"UNKNOWN\"";

unsigned long lastDataMillis = 0;
bool hasReceivedData = false;

// --------------------------------------------------
// Parse Uno message:
// DATA,soilRaw,moisture,temp,humidity,rain,pump,mode
// --------------------------------------------------

void parseUnoData(String line) {
  line.trim();

  if (!line.startsWith("DATA,")) {
    Serial.print("Uno: ");
    Serial.println(line);
    return;
  }

  String fields[8];
  int start = 0;

  for (int i = 0; i < 8; i++) {
    int comma = line.indexOf(',', start);

    if (i < 7 && comma == -1) {
      Serial.println("Incomplete DATA message");
      return;
    }

    if (i == 7) {
      fields[i] = line.substring(start);
    } else {
      fields[i] = line.substring(start, comma);
      start = comma + 1;
    }
  }

  // Only accept numeric fields or nan for sensor values.
  if (fields[1].length() == 0 ||
      fields[2].length() == 0 ||
      fields[3].length() == 0 ||
      fields[4].length() == 0) {
    return;
  }

  soilRaw = fields[1];
  moisture = fields[2];

  temperature = fields[3] == "nan"
      ? "null" : fields[3];

  humidity = fields[4] == "nan"
      ? "null" : fields[4];

  rain = fields[5] == "1" ? "true" : "false";
  pump = fields[6] == "1" ? "true" : "false";

  mode = fields[7] == "AUTO"
      ? "\"AUTO\"" : "\"MANUAL\"";

  hasReceivedData = true;
  lastDataMillis = millis();

  Serial.println("Sensor data received from Uno");
}

// --------------------------------------------------
// Read serial messages from Uno
// --------------------------------------------------

void readUnoSerial() {
  while (Serial2.available()) {
    char c = Serial2.read();

    if (c == '\n') {
      parseUnoData(receivedLine);
      receivedLine = "";
    } else if (c != '\r' && receivedLine.length() < 150) {
      receivedLine += c;
    } else if (receivedLine.length() >= 150) {
      receivedLine = "";
    }
  }
}

// --------------------------------------------------
// Web page
// --------------------------------------------------

void handleRoot() {
  String page = R"rawliteral(
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport"
            content="width=device-width, initial-scale=1">
      <title>Agri-Tek</title>
    </head>
    <body style="font-family:Arial;text-align:center;padding:20px">
      <h1>Agri-Tek</h1>
      <p>ESP32 Wi-Fi server is running.</p>
      <p><a href="/status">View sensor status (JSON)</a></p>
      <p>Refresh the status page to see the latest readings.</p>
    </body>
    </html>
  )rawliteral";

  server.send(200, "text/html", page);
}

// --------------------------------------------------
// Status endpoint
// --------------------------------------------------

void handleStatus() {
  bool dataFresh = hasReceivedData &&
                   millis() - lastDataMillis < 10000UL;

  String json = "{";
  json += "\"wifi\":\"";
  json += WiFi.status() == WL_CONNECTED
      ? "connected" : "disconnected";
  json += "\",\"ip\":\"" + WiFi.localIP().toString() + "\"";
  json += ",\"uno_connected\":";
  json += dataFresh ? "true" : "false";
  json += ",\"soil_raw\":" + soilRaw;
  json += ",\"moisture_percent\":" + moisture;
  json += ",\"temperature_c\":" + temperature;
  json += ",\"humidity_percent\":" + humidity;
  json += ",\"rain_wet\":" + rain;
  json += ",\"pump_on\":" + pump;
  json += ",\"mode\":" + mode;
  json += "}";

  server.send(200, "application/json", json);
}

// --------------------------------------------------
// Send command to Uno
// --------------------------------------------------

void sendUnoCommand(String command) {
  Serial2.println(command);
  Serial.print("Sent to Uno: ");
  Serial.println(command);
}

// /pump?state=1 or /pump?state=0
void handlePump() {
  if (!server.hasArg("state")) {
    server.send(400, "text/plain",
                "Missing state parameter");
    return;
  }

  if (server.arg("state") == "1") {
    sendUnoCommand("PUMP,1");
  } else if (server.arg("state") == "0") {
    sendUnoCommand("PUMP,0");
  } else {
    server.send(400, "text/plain", "Use state=1 or state=0");
    return;
  }

  server.send(200, "text/plain",
              "Command sent to Uno. Check /status for updates.");
}

// /mode?value=AUTO or /mode?value=MANUAL
void handleMode() {
  if (!server.hasArg("value")) {
    server.send(400, "text/plain", "Missing value parameter");
    return;
  }

  String value = server.arg("value");
  value.toUpperCase();

  if (value == "AUTO") {
    sendUnoCommand("MODE,AUTO");
  } else if (value == "MANUAL") {
    sendUnoCommand("MODE,MANUAL");
  } else {
    server.send(400, "text/plain",
                "Use value=AUTO or value=MANUAL");
    return;
  }

  server.send(200, "text/plain", "Mode command sent to Uno.");
}

// /threshold?value=35
void handleThreshold() {
  if (!server.hasArg("value")) {
    server.send(400, "text/plain", "Missing value parameter");
    return;
  }

  int value = server.arg("value").toInt();

  if (value < 0 || value > 90) {
    server.send(400, "text/plain",
                "Threshold must be between 0 and 90");
    return;
  }

  sendUnoCommand("THRESH," + String(value));
  server.send(200, "text/plain", "Threshold command sent to Uno.");
}

// --------------------------------------------------
// Setup
// --------------------------------------------------

void setup() {
  Serial.begin(9600);

  // Serial2: 9600 baud, RX=GPIO16, TX=GPIO17
  Serial2.begin(9600, SERIAL_8N1,
                ESP_RX_PIN, ESP_TX_PIN);

  delay(1000);

  Serial.println();
  Serial.println("Agri-Tek ESP32 starting...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;

  while (WiFi.status() != WL_CONNECTED &&
         attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("Wi-Fi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());

    server.on("/", handleRoot);
    server.on("/status", handleStatus);
    server.on("/pump", handlePump);
    server.on("/mode", handleMode);
    server.on("/threshold", handleThreshold);

    server.begin();
    Serial.println("Web server started!");
  } else {
    Serial.println();
    Serial.println("Wi-Fi failed. Check credentials and 2.4 GHz support.");
  }
}

// --------------------------------------------------
// Main loop
// --------------------------------------------------

void loop() {
  readUnoSerial();
  server.handleClient();
}
