const pick = (object, properties) => {
  const picked = {};
  object = object || {};

  properties.forEach(key => {
    if (Object.hasOwnProperty.call(object, key)) {
      picked[key] = object[key];
    }
  });

  return picked;
};

export default pick;
