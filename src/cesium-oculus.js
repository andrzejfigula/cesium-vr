var CesiumOculus = (function() {
  "use strict";

  function defaultErrorHandler(msg) {
    alert(msg);
  }

  var CesiumOculus = function(callback, errorHandler) {
    this.errorHandler = typeof errorHandler === 'undefined' ? defaultErrorHandler : errorHandler;
    this.state = undefined;
    this.hmdInfo = undefined;

    this.hmdDevice = undefined;
    this.sensorDevice = undefined;

    this.firstTime = true;
    this.refMtx = new Cesium.Matrix3();

    this.IPDScale = 1.0;

    var that = this;

    this.devices = undefined;

    function EnumerateVRDevices(devices) {
      // First find an HMD device
      console.log(devices);
      that.devices = devices;

      for (var i = 0; i < devices.length; ++i) {
        if (devices[i] instanceof HMDVRDevice) {
          that.hmdDevice = devices[i];
          break;
        }
      }

      if (!that.hmdDevice) {
        // No HMD detected.
        defaultErrorHandler("No HMD detected");
      }

      // Next find a sensor that matches the HMD hardwareUnitId
      for (var i = 0; i < devices.length; ++i) {
        if (devices[i] instanceof PositionSensorVRDevice &&
             (!that.hmdDevice || devices[i].hardwareUnitId == that.hmdDevice.hardwareUnitId)) {
          that.sensorDevice = devices[i];
          break;
        }
      }

      if (!that.sensorDevice) {
        // No HMD sensor detected.
        defaultErrorHandler("No HMD sensor detected");
      }

      that.frustumOffset = {
        "left" : that.hmdDevice.getEyeTranslation("left").x,
        "right" : that.hmdDevice.getEyeTranslation("right").x
      };

      if (typeof callback !== 'undefined') {
        callback();
      }
    }

    // Slight discrepancy in the api for WebVR currently.
    if (navigator.getVRDevices) {
      navigator.getVRDevices().then(EnumerateVRDevices);
    } else if (navigator.mozGetVRDevices) { // TODO: Still required?
      navigator.mozGetVRDevices(EnumerateVRDevices);
    }
  };

  CesiumOculus.prototype.setSceneParams = function(scene, eye) {
    switch (eye) {
    case "left":
    case "right":
      scene.camera.frustum.setOffset(this.frustumOffset[eye], 0.0);
      break;
    default:
      this.errorHandler("developer error, incorrect eye");
    }
  };

  CesiumOculus.prototype.toQuat = function(r) {
    if (r.x === 0 && r.y === 0 && r.z === 0 && r.w === 0) {
      return Cesium.Quaternion.IDENTITY;
    }
    return new Cesium.Quaternion(r.x, r.y, r.z, r.w);
  };

  CesiumOculus.prototype.getRotation = function() {
    var state = this.sensorDevice.getState();

    if (state.orientation !== null) {
      return this.toQuat(state.orientation);
    } else {
      // No orientation from device.
      return this.toQuat({x : 0, y : 0, z : 0, w : 0});
    }
  };

  CesiumOculus.slaveCameraUpdate = function(master, eyeOffset, slave) {
    var right = new Cesium.Cartesian3();

    var eye = Cesium.Cartesian3.clone(master.position);
    var target = Cesium.Cartesian3.clone(master.direction);
    var up = Cesium.Cartesian3.clone(master.up);

    Cesium.Cartesian3.cross(target, up, right);
    
    // Get the focal point
    Cesium.Cartesian3.multiplyByScalar(target, 10000, target);
    // Cesium.Cartesian3.add(eye, target, target);

    // Move the camera horizontally with eyeOffset magnitude
    Cesium.Cartesian3.multiplyByScalar(right, eyeOffset, right);
    Cesium.Cartesian3.add(eye, right, eye);

    // Set the focal point as target, using converged.
    // Cesium.Cartesian3.subtract(temp, eye, target);

    // Using parallel line of sight (i.e. not converged)
    Cesium.Cartesian3.add(target, eye, target);

    slave.lookAt(eye, target, up);
  };

  CesiumOculus.setCameraRotationMatrix = function(rotation, camera) {
    Cesium.Matrix3.getRow(rotation, 0, camera.right);
    Cesium.Matrix3.getRow(rotation, 1, camera.up);
    Cesium.Cartesian3.negate(Cesium.Matrix3.getRow(rotation, 2, camera.direction), camera.direction);
  };

  CesiumOculus.getCameraRotationMatrix = function(camera) {
    var result = new Cesium.Matrix3();
    Cesium.Matrix3.setRow(result, 0, camera.right, result);
    Cesium.Matrix3.setRow(result, 1, camera.up, result);
    Cesium.Matrix3.setRow(result, 2, Cesium.Cartesian3.negate(camera.direction, new Cesium.Cartesian3()), result);
    return result;
  };

  // Not here!
  CesiumOculus.setCameraState = function(src, camera){
    camera.position = Cesium.Cartesian3.clone(src.position);
    camera.direction = Cesium.Cartesian3.clone(src.direction);
    camera.up = Cesium.Cartesian3.clone(src.up);
    camera.right = Cesium.Cartesian3.clone(src.right);
    camera.transform = Cesium.Matrix4.clone(src.transform);
    camera.frustum = src.frustum.clone();
  };

  CesiumOculus.prototype.levelCamera = function(camera) {
    this.firstTime = true;
    Cesium.Cartesian3.normalize(camera.position, camera.up);
    Cesium.Cartesian3.cross(camera.direction, camera.up, camera.right);
  };

  CesiumOculus.prototype.applyOculusRotation = function(camera, prevCameraMatrix, rotation) {
    var oculusRotationMatrix = Cesium.Matrix3.fromQuaternion(Cesium.Quaternion.inverse(rotation, new Cesium.Matrix3()));
    var sceneCameraMatrix = CesiumOculus.getCameraRotationMatrix(camera);
    if (this.firstTime) {
      Cesium.Matrix3.inverse(oculusRotationMatrix, this.refMtx);
      Cesium.Matrix3.multiply(this.refMtx, sceneCameraMatrix, this.refMtx);
    } else {
      var temp = new Cesium.Matrix3();
      Cesium.Matrix3.inverse(prevCameraMatrix, temp);
      Cesium.Matrix3.multiply(temp, sceneCameraMatrix, temp);
      Cesium.Matrix3.multiply(this.refMtx, temp, this.refMtx);
    }
    Cesium.Matrix3.multiply(oculusRotationMatrix, this.refMtx, prevCameraMatrix);
    CesiumOculus.setCameraRotationMatrix(prevCameraMatrix, camera);
    this.firstTime = false;
  };

  CesiumOculus.prototype.getDevice = function() {
    return this.hmdDevice;
  };

  return CesiumOculus;

}());
