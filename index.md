---
layout: page
title: dApp Boilerplate
tagline: Easy to build Web dApps
---
{% include JB/setup %}



<ul class="posts">
  {% for post in site.posts %}
    <li><span>{{ post.date | date_to_string }}</span> &raquo; <a href="{{ BASE_PATH }}{{ post.url }}">{{ post.title }}</a></li>
  {% endfor %}
</ul>

Work in progress:
<h3><a href="https://github.com/csantanapr/dapp-boilerplate" target="_blank">Fork me at Github: dapp-boilerplate</a></h3>




