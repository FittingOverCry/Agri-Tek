
from flask import Flask, jsonify, request
from flask_cors import CORS
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import json

app = Flask(__name__)
CORS(app)

# Replace with the IP printed by your ESP32.
ESP32_URL = "http://192.168.1.5"


def esp32_get(path):
    url = ESP32_URL.rstrip("/") + "/" + path.lstrip("/")
    with urlopen(ESP32_URL + path, timeout=3) as response:
        return json.loads(response.read().decode("utf-8"))


def esp32_command(path):
    url = ESP32_URL.rstrip("/") + "/" + path.lstrip("/")
    req = Request(ESP32_URL + path, method="GET")
    with urlopen(req, timeout=3) as response:
        return response.read().decode("utf-8")


@app.route("/")
def home():
    return jsonify({"message": "GreenFlow API is running"})


@app.route("/api/data", methods=["GET"])
def get_data():
    try:
        raw = esp32_get("/status")

        if not raw.get("uno_connected", False):
            return jsonify({
                "error": "Arduino Uno is not sending fresh data",
                "connected": False
            }), 503

        data = {
            "soil_moisture": raw.get("moisture_percent"),
            "temperature": raw.get("temperature_c"),
            "humidity": raw.get("humidity_percent"),
            "rain": raw.get("rain_wet"),
            "pump": raw.get("pump_on"),
            "mode": raw.get("mode"),
            "connected": True
        }

        return jsonify(data)

    except (URLError, HTTPError, TimeoutError, OSError,
            ValueError, json.JSONDecodeError) as exc:
        return jsonify({
            "error": "Could not read ESP32 status",
            "details": str(exc),
            "connected": False
        }), 502


@app.route("/api/mode", methods=["POST"])
def set_mode():
    body = request.get_json(silent=True) or {}
    mode = str(body.get("mode", "")).upper()

    if mode not in ("AUTO", "MANUAL"):
        return jsonify({
            "error": "Mode must be AUTO or MANUAL"
        }), 400

    try:
        result = esp32_command(
            "/mode?value=" + mode
        )

        return jsonify({
            "success": True,
            "requested_mode": mode,
            "message": result
        })

    except (URLError, HTTPError, TimeoutError, OSError) as exc:
        return jsonify({
            "error": "Could not send mode command",
            "details": str(exc)
        }), 502


@app.route("/api/pump", methods=["POST"])
def pump_control():
    body = request.get_json(silent=True) or {}
    state = body.get("pump")

    if not isinstance(state, bool):
        return jsonify({
            "error": "pump must be true or false"
        }), 400

    try:
        # The pump may only be manually controlled in MANUAL mode.
        status = esp32_get("/status")

        if not status.get("uno_connected", False):
            return jsonify({
                "error": "Arduino Uno is not connected"
            }), 503

        if status.get("mode") != "MANUAL":
            return jsonify({
                "error": "Switch to MANUAL mode before controlling the pump"
            }), 409

        result = esp32_command(
            "/pump?state=" + ("1" if state else "0")
        )

        return jsonify({
            "success": True,
            "requested_pump": state,
            "message": result
        })

    except (URLError, HTTPError, TimeoutError, OSError,
            ValueError, json.JSONDecodeError) as exc:
        return jsonify({
            "error": "Could not control pump",
            "details": str(exc)
        }), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
