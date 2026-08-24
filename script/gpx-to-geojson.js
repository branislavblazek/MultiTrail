function gpxToGeoJson(file) {
  const reader = new FileReader();

  reader.onload = function (theFile) {
    console.log(theFile);
  };

  reader.readAsText(file, "UTF-8");
}
