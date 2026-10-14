// The one thing the eleven lessons of "Build toward a chatbot" need from the page.
(function () {
  'use strict';
  Array.prototype.forEach.call(document.querySelectorAll('main.lesson figure[id][aria-labelledby]'), function (f) { f.classList.add('fig', 'col'); });
})();
