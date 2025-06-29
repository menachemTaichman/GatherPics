from flask import Flask, jsonify, send_from_directory, request, send_file
from flask_cors import CORS
import json
import os
import zipfile
import io
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Paths
IMAGES_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'images')
IMAGES_DIR = os.path.abspath(IMAGES_DIR)
CLUSTERS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'clusters_faces.json')
CLUSTERS_FILE = os.path.abspath(CLUSTERS_FILE)

def load_clusters():
    """Load face clusters data"""
    try:
        with open(CLUSTERS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('clusters', [])
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []

def save_clusters(clusters):
    """Save face clusters data"""
    try:
        data = {'clusters': clusters}
        with open(CLUSTERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving clusters: {e}")
        return False

@app.route("/api/ping")
def ping():
    return jsonify({"status": "ok", "timestamp": datetime.now().isoformat()})

@app.route("/api/groups")
def get_groups():
    """Get all face groups"""
    clusters = load_clusters()
    return jsonify(clusters)

@app.route("/api/groups/<int:group_id>")
def get_group(group_id):
    """Get a specific face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    return jsonify(group)

@app.route("/api/groups/<int:group_id>", methods=["PUT"])
def update_group(group_id):
    """Update a face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    data = request.get_json()
    
    # Update allowed fields
    if 'label' in data:
        group['label'] = data['label']
    if 'representative' in data:
        # Verify the representative image exists in the group
        if data['representative'] in group.get('image_ids', []):
            group['representative'] = data['representative']
        else:
            return jsonify({"error": "Representative image not found in group"}), 400
    
    group['updated_at'] = datetime.now().isoformat()
    
    if save_clusters(clusters):
        return jsonify(group)
    else:
        return jsonify({"error": "Failed to save changes"}), 500

@app.route("/api/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    """Delete a face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    clusters = [g for g in clusters if g['id'] != group_id]
    
    if save_clusters(clusters):
        return jsonify({"message": "Group deleted successfully"})
    else:
        return jsonify({"error": "Failed to delete group"}), 500

@app.route("/api/groups/<int:group_id>/download")
def download_group(group_id):
    """Download all photos from a face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    # Create a zip file in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for image_id in group.get('image_ids', []):
            image_path = os.path.join(IMAGES_DIR, image_id)
            if os.path.exists(image_path):
                zip_file.write(image_path, image_id)
    
    zip_buffer.seek(0)
    
    filename = f"{group.get('label', f'Person_{group_id}')}.zip"
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=filename
    )

@app.route("/api/groups/<int:group_id>/download-selected", methods=["POST"])
def download_selected_photos(group_id):
    """Download selected photos from a face group"""
    clusters = load_clusters()
    group = next((g for g in clusters if g['id'] == group_id), None)
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    data = request.get_json()
    photo_ids = data.get('photoIds', [])
    
    if not photo_ids:
        return jsonify({"error": "No photos selected"}), 400
    
    # Verify all selected photos belong to the group
    group_photos = set(group.get('image_ids', []))
    if not all(photo_id in group_photos for photo_id in photo_ids):
        return jsonify({"error": "Some selected photos don't belong to this group"}), 400
    
    # Create a zip file in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for image_id in photo_ids:
            image_path = os.path.join(IMAGES_DIR, image_id)
            if os.path.exists(image_path):
                zip_file.write(image_path, image_id)
    
    zip_buffer.seek(0)
    
    filename = f"{group.get('label', f'Person_{group_id}')}_selected.zip"
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=filename
    )

@app.route("/api/download-all")
def download_all_photos():
    """Download all photos from all groups"""
    clusters = load_clusters()
    
    # Create a zip file in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # Add all unique photos
        all_photos = set()
        for group in clusters:
            all_photos.update(group.get('image_ids', []))
        
        for image_id in all_photos:
            image_path = os.path.join(IMAGES_DIR, image_id)
            if os.path.exists(image_path):
                zip_file.write(image_path, image_id)
    
    zip_buffer.seek(0)
    
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='face-gallery-all.zip'
    )

# Serve images
@app.route('/images/<path:filename>')
def get_image(filename):
    return send_from_directory(IMAGES_DIR, filename)

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)
