# Models

`face_landmarker.task` is Google's MediaPipe Face Landmarker (float16, version 1), downloaded from
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
and served from here so the Forge needs no third-party request. It is licensed under the Apache License 2.0
(https://www.apache.org/licenses/LICENSE-2.0). The browser runs it with `@mediapipe/tasks-vision` (Apache 2.0) to find
the 478 face landmarks a photo face is fitted with; the photo never leaves the browser for this step.
