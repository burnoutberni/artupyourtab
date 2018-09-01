/*!
Art Up Your Tab v1.x
Firefox add-on
*/


///////////
// HOOKS //
///////////

// Load content on install 
browser.runtime.onInstalled.addListener(function() {
  getStarted.updateData();
});

// Load content on new tab
browser.tabs.onUpdated.addListener(function(tabid, changeinfo, tab) {
  if (changeinfo.status == "complete")
    getStarted.updateData();
});

  // share tracking analytics
  var txt_shareFB =  "Facebook share in Firefox Extension";
  var txt_shareTW = "Twitter share in Firefox Extension";
  var txt_download = "Image download in Firefox Extension";
  var txt_artopen = "Tab opened in Firefox Extension";

/////////////////
// GET STARTED //
/////////////////

var getStarted = (function(){

  // settings
  var settings = {
    remote: 'http://www.art-tab.eu/wp-content/json-cache/post_data.json',
    debug: false,
    refresh: 60 * 60 * 4 // every 4 hours we check if the json has been updated on remote
  };
  const GA_TRACKING_ID = "UA-1301359-39";
  const GA_CLIENT_ID = generateGaClientId();

  // Get the current state
  var state = {
    timestamp: parseInt(localStorage.timestamp || 0, 10),
    cachestamp: parseInt(localStorage.cachestamp || 0, 10),
    data: JSON.parse(localStorage.data || '[]'),
    about: JSON.parse(localStorage.about || '[]')
  };

  // generates a client ID for Google Analytics
  function generateGaClientId() {
    var ts = Math.round(+new Date() / 1000.0);
    var rand;
    try{  
      var uu32 = new Uint32Array(1);
      rand = crypto.getRandomValues(uu32)[0];
    } catch(e) {
      rand = Math.round(Math.random() * 2147483647);
    }
    return [rand, ts].join('.');
  }

  // get current timestamp
  function Now() {
    return Math.ceil(+new Date() / 1000, 10);
  }

  // write to localStorage
  function writeData() {
    localStorage.data = JSON.stringify(state.data);
    localStorage.about = JSON.stringify(state.about);
  }

  // process new items
  function processData(json) {
    // update data if new
    if (json.timestamp != localStorage.timestamp) {
      console.log('json updated, UPDATE cache');
      localStorage.timestamp = state.timestamp = json.timestamp;
      var posts = json.items;
      state.about = json.about;
      // get old data to remove cache ids
      var removeFromCache = state.data.map(function(item){
        return item.id;
      });

      // update localstorage
      var counter = 0;
      state.data = posts.map(function(item){
        item.id = item.postid;
        item.preloaded = false;
        item.shown = false;
        var exists = state.data.filter(function(current){
          return current.postid == item.postid;
        });
        if (exists.length > 0) {
          removeFromCache = removeFromCache.filter(function(id){
            return id !== exists[0].id;
          });
          item.id = exists[0].id;
          item.preloaded = exists[0].preloaded;
          item.shown = exists[0].shown;
        }
        return item;
      });

      // remove item from cache that are not in json anymore
      removeFromCache.forEach(function(id){
        console.log('item removed from cache: '+id);
      });

      writeData();
      return new Promise(preloadImg);
    } else {
      return;
    }
  }

  function preloadImg(resolve, reject) {
    // check items that need preloading
    var needsPreloading = state.data.filter(function(item){
      return item.preloaded===false;
    });
    var nextItem = needsPreloading.shift();
    if (!nextItem) return;
    // preload the image in browser cache
    var image = new Image();
    image.src = nextItem.image;
    // set preloaded in localstorage
    var store = {};
    store[nextItem.id] = nextItem.id;
    // update cache
    state.data = state.data.map(function(item){
      if (item.id != nextItem.id) return item;
      item.preloaded = true;
      resolve(item);
      return item;
    });
    writeData();
    // next item
    new Promise(preloadImg);
  }

  function resetShown() {
    // update cache to reset shown cycle
    state.data = state.data.map(function(item){
      item.shown = false;
      return item;
    });
    writeData();
  }

  // exposed methods
  return {
    // update data
    updateData: function() {
      return new Promise(function(resolve, reject){
        // check every X hours (settings.refresh) for remote data changes
        if (state.data.length < 0 || (Now() - state.cachestamp) > settings.refresh) {
          // load remote
          fetch(settings.remote+'?'+Now())
          .then(function(response){
            console.log('got new json data from remote');
            localStorage.cachestamp = state.cachestamp = Now();
            return response.json().then(processData);
          })
          .then(resolve)
          .catch(function(response){
            localStorage.timestamp = state.timestamp = 0;
            reject(response);
          });
        }
      });
    },

    // get item data and render with stART.js
    renderItem: function() {
      return new Promise(function(resolve, reject){
        // preloaded items
        var preloaded = state.data.filter(function(item){
          return item.preloaded;
        });
        // not preloaded items
        var notPreloaded = state.data.filter(function(item){
          return !item.preloaded;
        });
        // // check if we need to process data
        if (preloaded.length === 0) {
          return getStarted.updateData().then(function(){
            getStarted.renderItem().then(resolve);
          });
        } else if (notPreloaded.length !== 0) {
          new Promise(preloadImg);
        }
        // not shown items
        var notShown = state.data.filter(function(item){
          return !item.shown;
        });
        // randomize order with Fisher-Yates
        fisherYates(notShown);
        // reset shown flags for next time
        if (notShown.length <= 1) {
          resetShown();
        }
        // get item
        var nextItem = notShown.shift();
        // Update the state and localStorage.
        state.data = state.data.map(function(item){
          if (item.id != nextItem.id) return item;
          item.shown = true;
          resolve(item);
          return item;
        });
        writeData();

        // send pageview and ArtOpen event to Analytics
        if(!settings.debug) {
          getStarted.GAsendPageView(nextItem.image,nextItem.title);
          getStarted.reportGA(txt_artopen, nextItem.title);
        }
      });
    },

    // get about data and render with stART.js
    renderAbout: function() {
      return new Promise(function(resolve, reject){
      resolve(state.about);
      });
    },

    // report the events to Google Analytics
    reportGA: function(category,action,label) {
      try {
        var request = new XMLHttpRequest();
        var message =
          "v=1&tid=" + GA_TRACKING_ID + "&cid= " + GA_CLIENT_ID + "&aip=1" +
          "&ds=add-on&t=event&ec="+category+"&ea="+action+"&el="+label;

        request.open("POST", "https://www.google-analytics.com/collect", true);
        request.send(message);
      } catch (e) {
        console.log("Error sending event to Google Analytics.\n" + e);
      }
    },
    // send pageview to Google Analytics 
    GAsendPageView: function(image,title) {
      try {
        var request = new XMLHttpRequest();
        var message =
          "v=1&t=pageview&aip=1&ds=add-on&tid="+GA_TRACKING_ID+"&cid= "+GA_CLIENT_ID+"&dp="+title+"&dt="+image;

        request.open("POST", "https://www.google-analytics.com/collect", true);
        request.send(message);
      } catch (e) {
        console.log("Error sending pageview to Google Analytics.\n" + e);
      }
    },
  };
})();

// FisherYates randomize 
function fisherYates(array) {
  var count = array.length,
      randomnumber,
      temp;
  while (count) {
    randomnumber = Math.random() * count-- | 0;
    temp = array[count];
    array[count] = array[randomnumber];
    array[randomnumber] = temp;
  }
}

/////////////////////////
// RENDER ITEM (stART) //
/////////////////////////

// get random data item and display
getStarted.renderItem().then(function(item){
  // selectors to insert the data
  var backgroundEl = document.getElementById('image-background');
  
  var infoBar = document.getElementById('info-bar');
  var imageThumb = document.getElementById('image-thumb');
  var shareDownload = document.getElementById('share-download');
  var shareFacebook = document.getElementById('share-facebook');
  var shareTwitter = document.getElementById('share-twitter');
  var infoShareFacebook = document.getElementById('info-share-facebook');
  var infoShareTwitter = document.getElementById('info-share-twitter');
  var itemDescription = document.getElementById('item-description');
  var itemTitle = document.querySelectorAll('.item-title');
  var itemMakers = document.querySelectorAll('.item-makers');
  var itemDate = document.querySelector('.item-date');
  var itemInstitution = document.querySelector('.item-institution');
  var itemInstitutionParent = document.querySelector('.item-institution-parent');
  var itemSourceParent = document.querySelector('.item-source-parent');
  var itemSource = document.querySelector('.item-source');
  var itemCurator = document.querySelector('.item-curator');
  var itemCuratorParent = document.querySelector('.item-curator-parent');
  var itemLicense = document.querySelector('.item-license').firstElementChild;

  // data image as a background
  backgroundEl.style.backgroundImage = 'url('+ item.image + ')';

  // insert json data into html
  imageThumb.src = item.image;
  shareDownload.href = item.image;
  shareFacebook.href = 'https://www.facebook.com/sharer/sharer.php?u='+item.shareurl;
  shareTwitter.href = 'https://twitter.com/intent/tweet?url='+item.shareurl;
  for (var i = 0; i < itemTitle.length; i++) {
    var title = document.createTextNode(item.title);
    itemTitle[i].appendChild(title);
  }
  for (i = 0; i < itemMakers.length; i++) {
    var makers = document.createTextNode(item.makers);
    itemMakers[i].appendChild(makers);
  }
  var description_stripped = filterXSS(item.description); // output filtering https://github.com/leizongmin/js-xss
  itemDescription.innerHTML = description_stripped;

  var creation_date = document.createTextNode(item.creation_date);
  itemDate.appendChild(creation_date);

  infoShareFacebook.href = 'https://www.facebook.com/sharer/sharer.php?u='+item.shareurl;
  infoShareTwitter.href = 'https://twitter.com/intent/tweet?url='+item.shareurl;

  if (item.Institution && item.institution_url) {
    itemInstitutionParent.style.display = 'block';
    itemInstitution.firstElementChild.title = item.Institution;
    itemInstitution.firstElementChild.href = item.institution_url;
    var Institution = document.createTextNode(item.Institution);
    itemInstitution.firstElementChild.appendChild(Institution);
  } else {
    itemInstitutionParent.style.display = 'none';
  }

  if (item.curator && item.curator_url) {
    itemCuratorParent.style.display = 'block';
    itemCurator.firstElementChild.title = item.curator;
    itemCurator.firstElementChild.href = item.curator_url;
    var Curator = document.createTextNode(item.curator);
    itemCurator.firstElementChild.appendChild(Curator);
  } else {
    itemCuratorParent.style.display = 'none';
  }

  if (item.europeana_url) {
    itemSourceParent.style.display = 'block';
    itemSource.firstElementChild.href = item.europeana_url;
  } else {
    itemSourceParent.style.display = 'none';
  }

  itemLicense.href = item.license_data.url;
  if (item.license_data.icons) {
    var licenseIcons = item.license_data.icons.reverse();
    for (var i = licenseIcons.length - 1; i >= 0; i--) {
      if (item.license_data.icons[i].length>0) {
        var element = document.createElement("i");
        element.className = item.license_data.icons[i];
        itemLicense.appendChild(element);
      }
    }
  }
  
  // render about box data
  getStarted.renderAbout().then(function(about){
    var aboutTitle = document.getElementById('about-title');
    var aboutContent = document.getElementById('about-content');
    var aboutPartners = document.getElementById('partners');
    // insert data into about box
    var aboutTitle_txt = document.createTextNode(about.title);
    aboutTitle.appendChild(aboutTitle_txt);
    var aboutContent_stripped = filterXSS(about.content); // output filtering https://github.com/leizongmin/js-xss
    aboutContent.innerHTML = aboutContent_stripped;
  });

  // Fade-in all elements (delays are set in CSS)
  requestAnimationFrame(function(){
    backgroundEl.style.opacity = 1;
    infoBar.style.opacity = 1;
  });
});

/////////////////
// INTERACTION //
/////////////////

// UI elements

var infoBtn = document.getElementById('info-button');
var infoBarWrapper = document.getElementById('info-bar-wrapper');
var infoBar = document.getElementById('info-bar');
var startBtn = document.getElementById('start-button');
var infoBarShare = document.getElementById('share-button');
var infoBarShareBox = document.getElementById('share-box');
var infoBox = document.getElementById('info-box');
var aboutBox = document.getElementById('about-box');
var modalBox = document.getElementById('modal-box');
var closeBtn = document.querySelectorAll('.close');
var backBtn = document.querySelector('.back');
var bgImage = document.getElementById('image-background');

// UI actions
function toggleInfoBox(el) {
  if (!el.classList.contains("show")) {
    openItem(modalBox);
    openItem(infoBox);   
  } else {
    closeItem(modalBox);
    closeItem(aboutBox);
  }
}
function toggleShareBox(close) {
  if (infoBarShare.classList.contains("open")) {
    infoBarShare.classList.remove('open');
    infoBarShareBox.classList.remove('show');   
  } else if (!close) {
    infoBarShare.classList.add('open');
    infoBarShareBox.classList.add('show');
  }
}
      

function closeItem(el) {
    el.classList.remove("show");
}
function openItem(el) {
    el.classList.add("show");
}

// onload binders
window.onload = function() {

  // toggle bottom bar
  infoBarWrapper.addEventListener("mouseenter", function() {
    if (!modalBox.classList.contains('show')) {
      infoBar.classList.remove('hide');
    }
  });
  infoBarWrapper.addEventListener("click", function() {
    if (!modalBox.classList.contains('show')) {
      infoBar.classList.remove('hide');
    }
  });
  infoBarWrapper.addEventListener("mouseleave", function() {
    infoBar.classList.add('hide');
    toggleShareBox('close');
  });

  // auto hide bottom bar
  setTimeout(function(){
    if (!infoBar.classList.contains('hide')) {
      infoBar.classList.add('hide');
    }
  }, 2000);

  // info button on info bar
  infoBtn.onclick=function(){toggleInfoBox(modalBox);};

  // close modal box
  bgImage.onclick=function(){toggleInfoBox(modalBox);};
  closeBtn[0].onclick=function(){toggleInfoBox(modalBox);};
  closeBtn[1].onclick=function(){toggleInfoBox(modalBox);};

  // open about box
  startBtn.onclick=function(){
    openItem(aboutBox);
    closeItem(infoBox);
  };

  // close about box
  backBtn.onclick=function(){
    closeItem(aboutBox);
    openItem(infoBox);
  };

  // toggle share infobar
  infoBarShare.onclick=function(){toggleShareBox();};

  // share tracking analytics
  var share_value = document.querySelector('h1.item-title');
  // FB share event
  var FB1 = document.getElementById('info-share-facebook');
  var FB2 = document.getElementById('share-facebook');
  FB1.addEventListener('click', function(e) {
    getStarted.reportGA(txt_shareFB, share_value.textContent);
  });
  FB2.addEventListener('click', function(e) {
    getStarted.reportGA(txt_shareFB, share_value.textContent);
  });
  // Twitter share event
  var TW1 = document.getElementById('info-share-twitter');
  var TW2 = document.getElementById('share-twitter');
  TW1.addEventListener('click', function(e) {
   getStarted.reportGA(txt_shareTW, share_value.textContent);
  });
  TW2.addEventListener('click', function(e) {
    getStarted.reportGA(txt_shareTW, share_value.textContent);
  });
  // Download event
  var DL = document.getElementById('share-download');
  DL.addEventListener('click', function(e) {
    getStarted.reportGA(txt_download, share_value.textContent);
  });
};

