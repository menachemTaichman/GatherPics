from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import json
import os

app = Flask(__name__)
CORS(app)

# נתיב מלא לתמונות בתיקיית data/images - תיקייה אחת מעל backend
IMAGES_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'images')

@app.route("/api/ping")
def ping():
    return jsonify({"status": "ok"})

@app.route("/api/groups")
def get_groups():
    groups_path = os.path.join(os.path.dirname(__file__), 'groups.json')
    with open(groups_path, 'r', encoding='utf-8') as f:
        groups = json.load(f)
    return jsonify(groups)

# נתיב שמשרת תמונות מתוך data/images
@app.route('/images/<path:filename>')
def get_image(filename):
    return send_from_directory(IMAGES_DIR, filename)

if __name__ == "__main__":
    app.run(debug=True)
