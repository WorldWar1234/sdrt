export default (obj, keys) => {
  const newObj = {};

  if (!obj) obj = {};
  if (!Array.isArray(keys)) {
    keys = [keys]; // convert to array
  }

  for (const key in obj) {
    if (Object.hasOwnProperty.call(obj, key) && keys.includes(key)) {
      newObj[key] = obj[key];
    }
  }

  return newObj;
};
