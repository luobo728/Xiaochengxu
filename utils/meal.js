// utils/meal.js —— 餐次常量（客户端展示页与管理端共用，顺序即展示顺序）
const MEALS = [
  { key: 'breakfast', name: '早餐', time: '07:30' },
  { key: 'morning', name: '早点', time: '09:30' },
  { key: 'lunch', name: '午餐', time: '11:30' },
  { key: 'afternoon', name: '午点', time: '15:00' },
  { key: 'dinner', name: '晚餐', time: '16:30' }
]

const MEAL_KEYS = MEALS.map(function (item) {
  return item.key
})

function mealName(key) {
  for (let i = 0; i < MEALS.length; i++) {
    if (MEALS[i].key === key) return MEALS[i].name
  }
  return ''
}

function mealTime(key) {
  for (let i = 0; i < MEALS.length; i++) {
    if (MEALS[i].key === key) return MEALS[i].time
  }
  return ''
}

function isMeal(key) {
  return MEAL_KEYS.indexOf(key) > -1
}

module.exports = {
  MEALS: MEALS,
  MEAL_KEYS: MEAL_KEYS,
  mealName: mealName,
  mealTime: mealTime,
  isMeal: isMeal
}
