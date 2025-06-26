import requests
import os
import time

# פרטי גישה ל-Azure Face API
subscription_key = '***REMOVED_AZURE_KEY***'
endpoint = 'https://face-recognition-met.cognitiveservices.azure.com/'

face_api_url = f'{endpoint}/face/v1.0/detect'

headers = {
    'Ocp-Apim-Subscription-Key': subscription_key,
    'Content-Type': 'application/octet-stream'
}

params = {
    'returnFaceId': 'true',
    'returnFaceLandmarks': 'false',
}

# תיקייה עם התמונות
image_folder = 'data/images'

image_files = [
    f for f in os.listdir(image_folder)
    if f.lower().endswith(('.jpg', '.jpeg', '.png'))
]

for i, filename in enumerate(image_files, 1):
    image_path = os.path.join(image_folder, filename)
    print(f"\n🔍 image {i}: {filename}")

    with open(image_path, 'rb') as image_data:
        response = requests.post(
            face_api_url,
            headers=headers,
            params=params,
            data=image_data
        )

    if response.status_code != 200:
        print(f"❌ Error: {response.status_code} - {response.text}")
        continue

    faces = response.json()
    if not faces:
        print("😕 No face was recognized")
        continue

    for face in faces:
        rect = face['faceRectangle']
        print(f"🧑‍🦰 faces recognized-{rect}")
        print(f" - faceId: {face['faceId']}")

    
    time.sleep(1.2)  # לא לעבור את מגבלת הקצב (20 לדקה ב-F0)

