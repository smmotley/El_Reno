import * as colorTexture from './color_texture.js';

var timeStamps = {
    'N0R': [],
    'N0V': []
};
window.tileLayers = {};

const valueMap = [
    200,
    199,
    198,
    197,
    196,
    195,
    194,
    193,
    192,
    191,
    190,
    189,
    188,
    187,
    186,
    185,
    184,
    183,
    182,
    181,
    180,
    179,
    178,
    177,
    176,
    175,
    174,
    173,
    172,
    171,
    170,
    169,
    168,
    167,
    166,
    165,
    164,
    163,
    162,
    161,
    160,
    159,
    158,
    157,
    156,
    155,
    154,
    153,
    152,
    151,
    150,
    149,
    148,
    147,
    146,
    145,
    144,
    143,
    142,
    141,
    140,
    139,
    138,
    137,
    136,
    135,
    134,
    133,
    132,
    131,
    130,
    129,
    128,
    127,
    126,
    125,
    124,
    123,
    122,
    121,
    120,
    119,
    118,
    117,
    116,
    115,
    114,
    113,
    112,
    111,
    110,
    109,
    108,
    107,
    106,
    105,
    104,
    103,
    102,
    101,
    100,
    99,
    98,
    97,
    96,
    95,
    94,
    93,
    92,
    91,
    90,
    89,
    88,
    87,
    86,
    85,
    84,
    83,
    82,
    81,
    80,
    79,
    78,
    77,
    76,
    75,
    74,
    73,
    72,
    71,
    70,
    69,
    68,
    67,
    66,
    65,
    64,
    63,
    62,
    61,
    60,
    59,
    58,
    57,
    56,
    55,
    54,
    53,
    52,
    51,
    50,
    49,
    48,
    47,
    46,
    45,
    44,
    43,
    42,
    41,
    40,
    39,
    38,
    37,
    36,
    35,
    34,
    33,
    32,
    31,
    30,
    29,
    28,
    27,
    26,
    25,
    24,
    23,
    22,
    21,
    20,
    19,
    18,
    17,
    16,
    15,
    14,
    13,
    12,
    11,
    10,
    9,
    8,
    7,
    6,
    5,
    4,
    3,
    2,
    1,
    0
];

const VALUE_RANGE = [0, 200];

var speedFactor = 30; // number of frames per longitude degree
var animation; // to store and cancel the animation
var startTime = 0;
var progress = 0; // progress = timestamp - startTime
var resetTime = false; // indicator of whether time reset is needed for the animation
var pauseButton = document.getElementById('pause');
var animation; // to store and cancel the animatio
tileLayers.baseURL={
   NEXRAD_REALTIME: (tileNames,i) => `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::TLX-N0Q-${tileNames[i]}/{z}/{x}/{y}.png`,
   NEXRAD_LEVELII: (tileNames,i) => `https://a.tiles.mapbox.com/v4/smotley.N0R_${tileNames[i]}/{z}/{x}/{y}.png?access_token=pk.eyJ1Ijoic21vdGxleSIsImEiOiJuZUVuMnBBIn0.xce7KmFLzFd9PZay3DjvAA`,
}


var geojson = {
    type: "FeatureCollection",
    features: [],
};

var geojsonLine = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [
                [0, 0]
            ]
        }
    }]
};

function showLoading(){}

function removeLoading(){}

/*
For a given gray scale png, there is a range of color values from 0 to 255. We could, if we wanted, only show
the values from, say, 0 to 100. That's what createValueMap does. It says, if we give VALUE_RANGE a value different
than [0,255] (e.g. (0-50), then it will give return an array below (map[i]) where all array values over 50 == 0.
 */
function createValueMap(min, max) {
    const map = [...valueMap];

    for (let i = 0; i < 256; i++) {
        if (i <= min || i >= max) {
            map[i] = 0;
        }
    }
    return map;
}

function colorFunction(value, step = 0.5) {

    if (value < 5) return 'transparent';
    const maxVal = 70;
    const minVal = 0;
    const range = Math.floor(360 / (maxVal - minVal))
    const finalValue = VALUE_RANGE[1] + (value-VALUE_RANGE[1])*(range-1)
//  const scaled = Math.round((-value / VALUE_RANGE[1]) * 360) + 220; //For radar
//    const scaled = Math.round((value / VALUE_RANGE[1]) * 360); //the value is some percentage of 360
//    const finalValue = (scaled + step) % 360;
    return `hsla(${finalValue}, 100%, 50%, 0.5)`;
}

function filterBy(timeStamp, map, animate) {
    //>=
    var geoLine = []
    var filters = ['<=', 'time', timeStamp];
    map.setFilter('earthquake-circles', filters);
    var circles = map.queryRenderedFeatures({layers:['earthquake-circles']});
        geoLine = geojson.features.map(function(d) {
            if (d.properties.time <= timeStamp) {
                geoLine.push(d.geometry.coordinates);
            }
        return geoLine;
    });
     geojsonLine.features[0].geometry.coordinates = geoLine[0]
     map.getSource('route-line').setData(geojsonLine)

    if (animate === true){
        //animation = requestAnimationFrame(filterBy);
    }
    // Set the label to the month
    const parseTime = d3.timeParse("%s");
    var datetime = parseTime(Math.floor(timeStamp/1000));
    const displayTime = d3.timeFormat("%b %d, %Y %H:%MZ")
    datetime = displayTime(datetime)
    document.getElementById('timeStamps').textContent = datetime;
}

function json2geojson(json){
    for (var i = 0; i < json.data.length; i++) {
    geojson.features.push({
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [json.data[i]["-lon"], json.data[i]["-lat"]]
        },
        "properties": {
            "time": json.data[i]["time"],
        }
    });
}
return geojson
}
async function getProductTimes(radarID,product,startTime,endTime){
    const times = [];
        const response = await fetch('https://mesonet.agron.iastate.edu/json/radar?operation=list&radar='+radarID+'&product='+product+'&start=' +
            startTime+'&end='+endTime);
        const json = await response.json();
        var minTime = 0
        for (let i = 0; i < json['scans'].length; i++) {
            var datetime = json['scans'][i]['ts']
            const parsetime = d3.timeParse("%Y-%m-%dT%H:%MZ");
                    datetime = parsetime(datetime);
            const formatForTiles = d3.timeFormat("%Y%m%d%H%M");
            const formatForDisplay = d3.timeFormat("%b %d, %Y %H:%MZ");
            times.push(formatForTiles(datetime))
            timeStamps.push(datetime.getTime())
            if (i===0) minTime = datetime.getTime() //set min time on the slider to be the first time found (in epoch)
        }

        //times.reverse();
    const maxTime = datetime.getTime() //set max time on the slider as the last time found (in epoch)
    d3.select('#slider')
        .attr('max',maxTime)
        .attr('min',minTime)
    return times;
}

async function getProductTimesMapBox(radarID,startTime,endTime){
    const times = {
        'N0R': [],
        'N0V': []
    };
    const response = await fetch('https://api.mapbox.com/tilesets/v1/smotley?access_token=' +
        'sk.eyJ1Ijoic21vdGxleSIsImEiOiJjamc4N3d1emQweGlyMndxbDJ4bHhhZG83In0.HEx-u5aYqDKo00gaPjUjKA');
    const json = await response.json();
    for (let i=0; i < json.length; i++){
        if (json[i].name.includes('_2013') ){
            const product = json[i].name.substring(0,3)
            var datetime = json[i].name;
            //times.push(datetime)
            const tileDateString = datetime.substring(datetime.lastIndexOf(product+'_') + 4);
            const parsetime = d3.timeParse("%Y%m%d_%H%M%S");

                datetime = parsetime(tileDateString);
            const formatForDisplay = d3.timeFormat("%b %d, %Y %H:%MZ");
            times[product].push(tileDateString);
            timeStamps[product].push(datetime.getTime());
            //if (i===0) var maxTime = datetime.getTime() //set min time on the slider to be the first time found (in epoch)
        }
    }
    // This is the longer version of what we're doing below with the arrow function (since I still don't understand them very well)
    function sortNumber(a,b){
        return a.slice(9) - b.slice(9)
    }
    times['N0R'].sort(sortNumber)
    times['N0V'].sort(sortNumber)
    timeStamps['N0R'].sort()
    timeStamps['N0V'].sort()

    //ids.sort((a, b) => a.slice(3) - b.slice(3));
    //ids.reverse();

    //times.reverse();
    //var minTime = datetime.getTime() //set max time on the slider as the last time found (in epoch)
    d3.select('#slider')
        .attr('max',timeStamps['N0R'][timeStamps['N0R'].length - 1])
        .attr('min',timeStamps['N0R'][0])
    return times;
}


function createMap(onLoad, mapboxgl = window.mapboxgl, options) {
    mapboxgl.accessToken = 'My_Token';
    var mapL = new mapboxgl.Map({
        container: 'mapL',
        style: 'mapbox://styles/mapbox/light-v9',
        center: [-99.4606, 35.7927],
        zoom: 5
    });
    var mapR = new mapboxgl.Map({
        container: 'mapR',
        style: 'mapbox://styles/mapbox/dark-v9',
        center: [-99.4606, 35.7927],
        zoom: 5
    });

    var map = new mapboxgl.Compare(mapL, mapR, {
        // Set this to enable comparing two maps by mouse movement:
        // mousemove: true
    });
    mapL.on('load', () => onLoad(mapL));
    mapL.on('load', () => onLoad(mapR));
}

createMap(map => {
    const vMap = createValueMap(...VALUE_RANGE);
/*
    map.addSource('satellite', {
                type: 'data-driven-raster',
                tiles: ['https://a.tiles.mapbox.com/v4/smotley.N0R_20130531_210706/{z}/{x}/{y}.png?access_token=pk.eyJ1Ijoic21vdGxleSIsImEiOiJuZUVuMnBBIn0.xce7KmFLzFd9PZay3DjvAA'],
                tileSize: 256,
                minzoom: 5,
                maxzoom: 9
            });
            map.addLayer({
                id: 'sat-tiles',
                type: 'data-driven-raster',
                source: 'satellite',
                paint: {
                    'raster-lookup-texture': colorTexture.create(vMap, colorFunction)

                },
            });
*/
   // const layerSat = map.getLayer('satellite');
   // const filterMapSat = createValueMap(0, 255);
//
   // layerSat.setGradientTexture(colorTexture.create(filterMapSat, colorFunction));

    d3.json('GPS.json')
        .then((data) => {
        // Create a month property value based on time
        // used to filter against.
        data = json2geojson(data)
        data.features = data.features.map(function (d) {
            const localTime = new Date(d.properties.time);
            const utc = localTime.getTime() + (localTime.getTimezoneOffset() * 60000);
            d.properties.time = utc;
            return d;
        });

        const dataLine = JSON.parse(JSON.stringify(data))
        dataLine.features = dataLine.features.map(function(d) {
            d.geometry.type = "LineString";
            return d;
        });

    //getProductTimes('TLX','N0Q','2013-05-31T22:00Z','2013-06-01T01:00Z').then(tileNames => {
     getProductTimesMapBox('TLX','2013-05-31T22:00Z','2013-06-01T01:00Z').then(tileNames => {

        for (var i=0; i < timeStamps['N0R'].length; i++) {
            const url = tileLayers.baseURL.NEXRAD_LEVELII(tileNames['N0R'], i)
            map.addSource('N0R' + timeStamps['N0R'][i], {
                "type": 'data-driven-raster',
                "tiles": [url],
                "tileSize": 256,
                "minzoom": 5,
                "maxzoom": 9
            });
        }
         for (var i=0; i < timeStamps['N0V'].length; i++) {
            const urlN0V = tileLayers.baseURL.NEXRAD_LEVELII(tileNames['N0V'], i)
            map.addSource('N0V' + timeStamps['N0V'][i], {
                "type": 'data-driven-raster',
                "tiles": [urlN0V],
                "tileSize": 256,
                "minzoom": 5,
                "maxzoom": 9
            });
        }

        map.addSource('earthquakes', {
            'type': 'geojson',
            'data': data
        });


        map.addLayer({
            'id': 'earthquake-circles',
            'type': 'circle',
            'source': 'earthquakes',
            'paint': {
                'circle-color': '#FCA107',
                'circle-opacity': 0.75,
                'circle-radius': 10
            }
        });

        map.addLayer({
            "id": "earthquake-circles-hover",
            'type': 'circle',
            "source": "earthquakes",
            "layout": {},
            "paint": {
                "circle-color": "#627BC1",
                "circle-opacity": 1,
                'circle-radius': 15
            },
            "filter": ["==", "time", ""]
        });

        map.addLayer({
            "id": "route-line",
            "type": "line",
            'source': {
                'type': 'geojson',
                'data': geojsonLine
            },
            "layout": {
                "line-join": "round",
                "line-cap": "round"
            },
            "paint": {
                "line-color": "#d10200",
                "line-width": 15,
                "line-opacity": 0.75
            }
        });

        const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false
        });

        map.on('mousemove', function (e) {
            document.getElementById('info').innerHTML =
                // e.point is the x, y coordinates of the mousemove event relative
                // to the top-left corner of the map
                JSON.stringify(e.point) + '<br />' +
                // e.lngLat is the longitude, latitude geographical position of the event
                JSON.stringify(e.lngLat);
        });

        map.on("mouseenter", "earthquake-circles", function (e) {
            var coordinates = e.features[0].geometry.coordinates.slice();
            var description = e.features[0].properties.time;

            // Ensure that if the map is zoomed out such that multiple
            // copies of the feature are visible, the popup appears
            // over the copy being pointed to.
            while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
            }

            // Populate the popup and set its coordinates
            // based on the feature found.
            popup.setLngLat(coordinates)
                .setHTML(description)
                .addTo(map);
            map.setFilter("earthquake-circles-hover", ["==", "time", e.features[0].properties.time]);
            //e.features[0].layer.paint['circle-radius'] = 50
            //map.setPaintProperty('earthquake-circles','circle-radius', 50)
        });

        map.on('mouseleave', 'earthquake-circles', function () {
            popup.remove();
        });

        // Set filter to first month of the year
        // 0 = January
        filterBy(data.features[0].properties.time, map, true);
        var playButton = d3.select("#pause")
            playButton
            .on("click", () => (console.log("HERE")))
        var stepForward = d3.select(".forward_arrow");
        var stepBackward = d3.select(".backward_arrow");
        var slider = d3.select("#slider")
         stepForward
             .on("click", function(){
                 var button = d3.select(this)
             })


        function sliderMoved(e){
            var datetime = parseInt(e.target.value, 10);
            const formatForTiles = d3.timeFormat("%Y%m%d%H%M");
            const formatForDisplay = d3.timeFormat("%b %d, %Y %H:%MZ");
            //datetime = parseTime(datetime);
            var parseTime = d3.timeParse("%s");
            var closestScan = timeStamps.sort((a,b) => Math.abs(datetime - a) - Math.abs(datetime - b))[0]
            var epochScan = parseTime(Math.floor(closestScan/1000));


            //var url = tileLayers.baseURL.NEXRAD_REALTIME([formatForTiles(epochScan)],0);
            try{
                map.addLayer({
                    id: "radar-tiles" + closestScan,
                    type: 'data-driven-raster',
                    source: "N0R" + closestScan,
                    paint: {
                        'raster-opacity': 0.0,
                        'raster-lookup-texture': colorTexture.create(vMap, colorFunction),
                        'raster-opacity-transition': {
                            'duration': 0
                        }
                    },
                });

                for (var j = 0; j < timeStamps.length; j++){
                    map.setPaintProperty("radar-tiles" + timeStamps[j], 'raster-lookup-texture', colorTexture.create([undefined], colorFunction));
                }
                map.setPaintProperty("radar-tiles" + closestScan, 'raster-lookup-texture', colorTexture.create(vMap, colorFunction));

            }
            catch(err){
                console.log("tiles already loaded")
            }
            filterBy(datetime, map, true);
            map.moveLayer('route-line');
            map.moveLayer('earthquake-circles')
            document.getElementById('info').innerHTML =
                // e.point is the x, y coordinates of the mousemove event relative
                // to the top-left corner of the map
                '<br /> Radar Scan:' +
                // e.lngLat is the longitude, latitude geographical position of the event
                epochScan;
        }

        
        document.getElementById('slider').addEventListener('input', function (e) {
            var datetime = parseInt(e.target.value, 10);
            const formatForTiles = d3.timeFormat("%Y%m%d%H%M");
            const formatForDisplay = d3.timeFormat("%b %d, %Y %H:%MZ");
            //datetime = parseTime(datetime);
            var parseTime = d3.timeParse("%s");
            var closestScan = timeStamps['N0R'].sort((a,b) => Math.abs(datetime - a) - Math.abs(datetime - b))[0]
            var epochScan = parseTime(Math.floor(closestScan/1000));


            //var url = tileLayers.baseURL.NEXRAD_REALTIME([formatForTiles(epochScan)],0);
            try{
                map.addLayer({
                    id: "radar-tiles" + closestScan,
                    type: 'data-driven-raster',
                    source: "N0R" + closestScan,
                    paint: {
                        'raster-opacity': 0.0,
                        'raster-lookup-texture': colorTexture.create(vMap, colorFunction),
                        'raster-opacity-transition': {
                            'duration': 0
                        }
                    },
                });

                for (var j = 0; j < timeStamps['N0R'].length; j++){
                    map.setPaintProperty("radar-tiles" + timeStamps['N0R'][j], 'raster-lookup-texture', colorTexture.create([undefined], colorFunction));
                }
                map.setPaintProperty("radar-tiles" + closestScan, 'raster-lookup-texture', colorTexture.create(vMap, colorFunction));

            }
            catch(err){
                console.log("tiles already loaded")
            }
            filterBy(datetime, map, true);
            map.moveLayer('route-line');
            map.moveLayer('earthquake-circles')
            document.getElementById('info').innerHTML =
                // e.point is the x, y coordinates of the mousemove event relative
                // to the top-left corner of the map
                '<br /> Radar Scan:' +
                // e.lngLat is the longitude, latitude geographical position of the event
                epochScan;

        });
    })
    });
});