// Draggable game cards for the midway panels
(function() {
  const DRAGGABLES = document.querySelectorAll('.eolMidTab[data-t]'); // or however you wrap them

  DRAGGABLES.forEach(function(el) {
    var isDragging = false, startX, startY, initialLeft, initialTop;

    el.addEventListener('mousedown', function(e) {
      // Only drag if clicking the card background, not buttons inside
      if (e.target.tagName === 'BUTTON') return;
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const style = window.getComputedStyle(el);
      initialLeft = el.offsetLeft;
      initialTop = el.offsetTop;
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      
      el.style.left = initialLeft + dx + 'px';
      el.style.top = initialTop + dy + 'px';
    });

    function stopDrag() {
      if (isDragging) {
        isDragging = false;
        el.style.transition = 'none'; // remove transition for instant follow
      }
    }

    document.addEventListener('mouseup', stopDrag);
    el.addEventListener('click', function(e) {
      // Don't trigger drag on actual button clicks
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
    });
  });
})();
