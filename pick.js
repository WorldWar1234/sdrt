// Picks specific properties from an object
const pick = (object, properties) => {
  let picked = {};
  for (let key in object || (object = {})) {
    if (Object.hasOwnProperty.call(object, key) && properties.includes(key)) {
      picked[key] = object[key];
    }
  }
  return picked;
};

export default pick;
